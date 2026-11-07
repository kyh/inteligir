import { blockHash } from "@repo/notes/library/block-hash";
import type { LibraryOp } from "@repo/notes/library/block-ops";
import { ensureLibrarySchema } from "@repo/notes/library/library-schema";
import { runPlanAsync } from "@repo/notes/library/library-sql";
import { mulberry32, pick } from "@repo/notes/test-support/seeded-random";
import { assert, describe, expect, it, vi } from "vitest";

import { fileSha } from "./library-replica";
import { openMemorySql } from "./memory-sql";
import type { MemorySql } from "./memory-sql";
import { STAGED_FILE_GONE } from "./outbox";
import type { LibraryReplica } from "./library-replica";
import type { BlockMerge, ReplicaTransport } from "./replica-ports";
import { deferred, nextTurn } from "./test-support/deferred";
import { createFakeCell } from "./test-support/fake-cell";
import type { FakeCell, FakeDevice } from "./test-support/fake-cell";
import { openDevice, paragraph, relaunch, textOf } from "./test-support/replica-harness";
import type { TestDevice } from "./test-support/replica-harness";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const OTHER_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 5, 6]);

const writes = (cell: FakeCell, device: string): number =>
  cell.calls.filter((call) => call === `${device} library/write`).length;

// a merge that keeps this device's block whole over the other's, and says it overlapped
const keepMine: BlockMerge = async ({ mine, theirs }) =>
  await Promise.resolve({ block: { ...mine, id: theirs.id }, overlapped: true });

// a note of two paragraphs, made on `device` and landed
const landedNote = async (cell: FakeCell, device: TestDevice): Promise<string> => {
  const { id } = await device.replica.createNote({
    blocks: [
      { block: paragraph("p1", "first"), ord: "a0", section: "note" },
      { block: paragraph("p2", "second"), ord: "a1", section: "note" },
    ],
    folderId: null,
    tags: [],
    title: "Plans",
  });
  await device.replica.sync();
  expect(cell.item(id)).not.toBeNull();
  return id;
};

// a put of one paragraph's text over the block as the replica reads it now
const putText = async (
  replica: LibraryReplica,
  itemId: string,
  blockId: string,
  text: string,
): Promise<LibraryOp> => {
  const item = await replica.item(itemId);
  const held = item?.blocks.find((stored) => stored.block.id === blockId);
  if (held === undefined) {
    throw new Error(`no block ${blockId} to put`);
  }
  return { baseHash: held.hash, block: paragraph(blockId, text), op: "put" };
};

// a picture block a write inserts, naming its file by sha
const pictureAt = (blockId: string, ord: string, sha: string): LibraryOp => ({
  block: { children: [{ text: "" }], id: blockId, sha, type: "img" },
  op: "insert",
  ord,
  section: "note",
});

const write = async (replica: LibraryReplica, itemId: string, ops: readonly LibraryOp[]) => {
  const outcome = await replica.write(itemId, { ops });
  expect(outcome.kind).toBe("queued");
};

const cellText = (cell: FakeCell, itemId: string, blockId: string): string | null => {
  const block = cell.item(itemId)?.blocks.get(blockId);
  return block === undefined ? null : textOf(block.block);
};

// one block as the replica reads it now
const heldBlock = async (replica: LibraryReplica, itemId: string, blockId: string) => {
  const item = await replica.item(itemId);
  return item?.blocks.find((held) => held.block.id === blockId);
};

const replicaText = async (
  replica: LibraryReplica,
  itemId: string,
  blockId: string,
): Promise<string | null> => {
  const block = await heldBlock(replica, itemId, blockId);
  return block === undefined ? null : textOf(block.block);
};

// a device's database, counting the transactions asked of it, so a suite can wait for one to
// queue behind a statement it holds, and holding the next one asked until the suite lets it go
interface CountedSql {
  readonly sql: MemorySql;
  readonly asked: () => number;
  readonly holdNext: () => { readonly reached: Promise<void>; readonly release: () => void };
}

const countedSql = async (): Promise<CountedSql> => {
  const sql = await openMemorySql();
  let asked = 0;
  let held: { readonly reached: () => void; readonly gate: Promise<void> } | null = null;
  return {
    asked: () => asked,
    holdNext: () => {
      const reached = deferred();
      const gate = deferred();
      held = { gate: gate.promise, reached: reached.resolve };
      return { reached: reached.promise, release: gate.resolve };
    },
    sql: {
      ...sql,
      exclusive: async (work) => {
        const gate = held;
        held = null;
        if (gate !== null) {
          gate.reached();
          await gate.gate;
        }
        asked += 1;
        return await sql.exclusive(work);
      },
    },
  };
};

// a device's network that a suite can hold at one call until it lets it go, or refuse calls on
interface HeldNetwork {
  readonly device: FakeDevice;
  readonly hold: (path: string) => {
    readonly reached: Promise<void>;
    readonly release: () => void;
  };
  readonly refused: Set<string>;
}

const heldNetwork = (cell: FakeCell, name: string): HeldNetwork => {
  const network = cell.device(name);
  const holds = new Map<string, { readonly reached: () => void; readonly gate: Promise<void> }>();
  const refused = new Set<string>();
  const transport: ReplicaTransport = {
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      if (refused.has(path)) {
        throw new TypeError("the network is down");
      }
      const held = holds.get(path);
      if (held !== undefined) {
        holds.delete(path);
        held.reached();
        await held.gate;
      }
      return await network.transport.fetch(request);
    },
    origin: network.transport.origin,
  };
  return {
    device: { ...network, transport },
    hold: (path) => {
      const reached = deferred();
      const gate = deferred();
      holds.set(path, { gate: gate.promise, reached: reached.resolve });
      return { reached: reached.promise, release: gate.resolve };
    },
    refused,
  };
};

const PULL = "/v1/rpc/library/sync/pull";

describe("the replica's outbox", () => {
  it("keeps offline writes across a relaunch and lands them in order once the cell answers", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    phone.network.setOffline(true);
    const { id } = await phone.replica.createNote({
      blocks: [{ block: paragraph("p1", "draft"), ord: "a0", section: "note" }],
      folderId: null,
      tags: [],
      title: "Offline",
    });
    await phone.replica.sync();
    await write(phone.replica, id, [await putText(phone.replica, id, "p1", "draft, edited")]);
    expect(phone.replica.status().unsent).toBe(2);

    const again = await relaunch(cell, "phone", phone);
    expect(again.replica.status().unsent).toBe(2);
    expect(again.replica.row(id)?.unsent).toBe(true);
    await expect(replicaText(again.replica, id, "p1")).resolves.toBe("draft, edited");

    again.network.setOffline(false);
    await again.replica.sync();
    expect(cellText(cell, id, "p1")).toBe("draft, edited");
    expect(again.replica.status()).toMatchObject({ failure: null, unsent: 0 });
    expect(again.replica.row(id)).toMatchObject({ title: "Offline", unsent: false });
    const item = await again.replica.item(id);
    expect(item?.seq).toBe(cell.item(id)?.seq);
  });

  it("sends three offline saves of one item as ONE write on the first base", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    const id = await landedNote(cell, phone);
    phone.network.setOffline(true);
    for (const text of ["one", "one two", "one two three"]) {
      await write(phone.replica, id, [await putText(phone.replica, id, "p1", text)]);
    }
    expect(phone.replica.status().unsent).toBe(1);
    phone.network.setOffline(false);
    await phone.replica.sync();
    expect(writes(cell, "phone")).toBe(1);
    expect(cellText(cell, id, "p1")).toBe("one two three");
  });

  it("answers a write whose base the screen no longer shows with the item as it reads", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    const id = await landedNote(cell, phone);
    const stale: LibraryOp = {
      baseHash: blockHash(paragraph("p1", "what it once said")),
      block: paragraph("p1", "mine"),
      op: "put",
    };
    const outcome = await phone.replica.write(id, { ops: [stale] });
    assert(outcome.kind === "changed", `the write answered ${outcome.kind}`);
    expect(outcome.item.blocks.map((held) => textOf(held.block))).toStrictEqual([
      "first",
      "second",
    ]);
    expect(phone.replica.status().unsent).toBe(0);
  });

  it("lands two devices' edits to different blocks with no round trip", async () => {
    const cell = createFakeCell();
    const mac = await openDevice(cell, "mac");
    const phone = await openDevice(cell, "phone");
    const id = await landedNote(cell, mac);
    await phone.replica.sync();
    await write(mac.replica, id, [await putText(mac.replica, id, "p1", "the Mac's")]);
    await write(phone.replica, id, [await putText(phone.replica, id, "p2", "the phone's")]);
    await mac.replica.sync();
    await phone.replica.sync();
    expect(writes(cell, "phone")).toBe(1);
    expect(cellText(cell, id, "p1")).toBe("the Mac's");
    expect(cellText(cell, id, "p2")).toBe("the phone's");
    await expect(replicaText(phone.replica, id, "p1")).resolves.toBe("the Mac's");
  });

  it("merges two devices' edits to the same block through the merge port and sends it again", async () => {
    const cell = createFakeCell();
    const mac = await openDevice(cell, "mac");
    const phone = await openDevice(cell, "phone");
    const id = await landedNote(cell, mac);
    await phone.replica.sync();
    await write(mac.replica, id, [await putText(mac.replica, id, "p1", "the Mac's")]);
    await mac.replica.sync();
    await write(phone.replica, id, [await putText(phone.replica, id, "p1", "the phone's")]);
    await phone.replica.sync();
    expect(writes(cell, "phone")).toBe(2);
    expect(cellText(cell, id, "p1")).toBe("the Mac's / the phone's");
    await expect(replicaText(phone.replica, id, "p1")).resolves.toBe("the Mac's / the phone's");
  });

  it("says which item a merge kept this device's lines in over another device's", async () => {
    const cell = createFakeCell();
    const mac = await openDevice(cell, "mac");
    const phone = await openDevice(cell, "phone", { merge: keepMine });
    const id = await landedNote(cell, mac);
    await phone.replica.sync();
    await write(mac.replica, id, [await putText(mac.replica, id, "p1", "the Mac's")]);
    await mac.replica.sync();
    const overlapped: string[] = [];
    phone.replica.onChange((change) => {
      overlapped.push(...change.overlapped);
    });
    await write(phone.replica, id, [await putText(phone.replica, id, "p2", "the phone's")]);
    await phone.replica.sync();
    expect(overlapped).toStrictEqual([]);
    await write(mac.replica, id, [await putText(mac.replica, id, "p1", "the Mac's again")]);
    await mac.replica.sync();
    await write(phone.replica, id, [await putText(phone.replica, id, "p1", "the phone's")]);
    await phone.replica.sync();
    expect(overlapped).toStrictEqual([id]);
    expect(cellText(cell, id, "p1")).toBe("the phone's");
  });

  it("stands a block another device dropped again with this device's edit", async () => {
    const cell = createFakeCell();
    const mac = await openDevice(cell, "mac");
    const phone = await openDevice(cell, "phone");
    const id = await landedNote(cell, mac);
    await phone.replica.sync();
    const held = await heldBlock(mac.replica, id, "p1");
    await write(mac.replica, id, [{ baseHash: held?.hash ?? "", blockId: "p1", op: "drop" }]);
    await mac.replica.sync();
    expect(cellText(cell, id, "p1")).toBeNull();
    await write(phone.replica, id, [await putText(phone.replica, id, "p1", "kept by the phone")]);
    await phone.replica.sync();
    expect(cellText(cell, id, "p1")).toBe("kept by the phone");
    expect(cell.item(id)?.blocks.get("p1")?.ord).toBe("a0");
  });

  it("lets a drop of a block another device edited go, keeping the edit", async () => {
    const cell = createFakeCell();
    const mac = await openDevice(cell, "mac");
    const phone = await openDevice(cell, "phone");
    const id = await landedNote(cell, mac);
    await phone.replica.sync();
    await write(mac.replica, id, [await putText(mac.replica, id, "p2", "edited on the Mac")]);
    await mac.replica.sync();
    const held = await heldBlock(phone.replica, id, "p2");
    await write(phone.replica, id, [{ baseHash: held?.hash ?? "", blockId: "p2", op: "drop" }]);
    await phone.replica.sync();
    expect(cellText(cell, id, "p2")).toBe("edited on the Mac");
    expect(phone.replica.status().unsent).toBe(0);
    await expect(replicaText(phone.replica, id, "p2")).resolves.toBe("edited on the Mac");
  });

  it("lands a write whose answer was lost once: no second item", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    const { id } = await phone.replica.createNote({
      blocks: [],
      folderId: null,
      tags: [],
      title: "Once",
    });
    phone.network.loseAnswers(1);
    await phone.replica.sync();
    expect(phone.replica.status().failure?.kind).toBe("unreachable");
    expect(cell.items().size).toBe(1);
    await phone.replica.sync();
    expect(cell.items().size).toBe(1);
    expect(phone.replica.status()).toMatchObject({ failure: null, unsent: 0 });
    expect(phone.replica.row(id)?.unsent).toBe(false);
  });

  it("lands an edit made after a write whose answer was lost on top of it", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    const id = await landedNote(cell, phone);
    await write(phone.replica, id, [await putText(phone.replica, id, "p1", "one")]);
    phone.network.loseAnswers(1);
    await phone.replica.sync();
    await write(phone.replica, id, [await putText(phone.replica, id, "p1", "two")]);
    expect(phone.replica.status().unsent).toBe(2);
    await phone.replica.sync();
    expect(cellText(cell, id, "p1")).toBe("two");
    expect(writes(cell, "phone")).toBe(3);
    expect(phone.replica.status().unsent).toBe(0);
  });

  it("counts a resend the cell no longer remembers as landed when the item already holds it", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    const id = await landedNote(cell, phone);
    await write(phone.replica, id, [await putText(phone.replica, id, "p1", "mine")]);
    phone.network.loseAnswers(1);
    await phone.replica.sync();
    const head = cell.head();
    cell.forgetAnswers();
    await phone.replica.sync();
    expect(cell.head()).toBe(head);
    expect(cellText(cell, id, "p1")).toBe("mine");
    expect(phone.replica.status().unsent).toBe(0);
  });

  it("parks a write the cell refuses for its size, keeping its text, while another item goes on", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    const big = await landedNote(cell, phone);
    const small = await landedNote(cell, phone);
    cell.tooLarge.add(big);
    await write(phone.replica, big, [await putText(phone.replica, big, "p1", "far too much")]);
    await write(phone.replica, small, [await putText(phone.replica, small, "p1", "fine")]);
    await phone.replica.sync();
    expect(cellText(cell, small, "p1")).toBe("fine");
    expect(cellText(cell, big, "p1")).toBe("first");
    const [parked] = phone.replica.status().parked;
    expect(parked).toMatchObject({
      itemIds: [big],
      reason: "This is too large to keep in one item.",
    });
    await write(phone.replica, big, [await putText(phone.replica, big, "p2", "held behind it")]);
    await phone.replica.sync();
    expect(cellText(cell, big, "p2")).toBe("second");
    expect(phone.replica.status().unsent).toBe(2);
    await expect(replicaText(phone.replica, big, "p1")).resolves.toBe("far too much");
    expect(phone.replica.row(big)?.parked).toBe(true);

    cell.tooLarge.delete(big);
    await phone.replica.retry(parked?.seq ?? 0);
    await phone.replica.sync();
    expect(cellText(cell, big, "p1")).toBe("far too much");
    expect(cellText(cell, big, "p2")).toBe("held behind it");
    expect(phone.replica.status().unsent).toBe(0);
  });

  it("lets a parked write go when the person discards it, showing the item as the cell holds it", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    const id = await landedNote(cell, phone);
    cell.tooLarge.add(id);
    await write(phone.replica, id, [await putText(phone.replica, id, "p1", "far too much")]);
    await phone.replica.sync();
    const [parked] = phone.replica.status().parked;
    await phone.replica.discard(parked?.seq ?? 0);
    expect(phone.replica.status().unsent).toBe(0);
    await expect(replicaText(phone.replica, id, "p1")).resolves.toBe("first");
  });

  it("lists a make, a delete and a folder before the cell holds them", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    const landed = await landedNote(cell, phone);
    phone.network.setOffline(true);
    const { id } = await phone.replica.createNote({
      blocks: [{ block: paragraph("p1", "## not a heading"), ord: "a0", section: "note" }],
      folderId: null,
      tags: ["drafts"],
      title: "",
    });
    await phone.replica.deleteItems([landed]);
    const folderId = phone.newId();
    await phone.replica.writeFolders([
      { id: folderId, name: "Reading", op: "create", parentId: null, sort: "a0" },
    ]);
    const live = phone.replica.listing({ deleted: false, limit: 10, offset: 0, sort: "saved" });
    expect(live.items.map((row) => [row.id, row.unsent, row.tags])).toStrictEqual([
      [id, true, ["drafts"]],
    ]);
    const deleted = phone.replica.listing({ deleted: true, limit: 10, offset: 0, sort: "saved" });
    expect(deleted.items.map((row) => row.id)).toStrictEqual([landed]);
    expect(phone.replica.folders().map((folder) => folder.name)).toStrictEqual(["Reading"]);

    phone.network.setOffline(false);
    await phone.replica.sync();
    expect(cell.item(landed)?.fields.deletedAt).not.toBeNull();
    expect(cell.folder(folderId)?.name).toBe("Reading");
    expect(phone.replica.folders().map((folder) => folder.name)).toStrictEqual(["Reading"]);
    expect(phone.replica.row(id)?.unsent).toBe(false);
  });

  it("uploads a file before the item that names it, and lets its bytes go once that lands", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    const file = await phone.replica.createFile({
      file: { bytes: PNG, mime: "image/png" },
      folderId: null,
      name: "diagram.png",
      tags: [],
    });
    expect(phone.replica.row(file.id)?.kind).toBe("image");
    await phone.replica.sync();
    expect(cell.uploads).toStrictEqual([file.sha]);
    expect(cell.item(file.id)?.fields.originalSha).toBe(file.sha);
    expect(phone.blobs.held()).toStrictEqual([]);
  });

  it("keeps a note's picture, uploads it before the write that names it, and lets it go once that lands", async () => {
    const cell = createFakeCell();
    const network = heldNetwork(cell, "phone");
    const phone = await openDevice(cell, "phone", { network: network.device });
    const id = await landedNote(cell, phone);
    phone.network.setOffline(true);
    const { sha } = await phone.replica.keepFile({ bytes: OTHER_PNG, mime: "image/png" });
    expect(sha).toBe(fileSha(OTHER_PNG));
    expect(phone.replica.status().unsent, "a kept file alone is no change of the person's").toBe(0);
    await phone.replica.write(id, { ops: [pictureAt("i1", "a2", sha)] });
    expect(phone.blobs.held()).toStrictEqual([sha]);
    expect(phone.replica.status().unsent, "the picture is one change, the write naming it").toBe(1);
    phone.network.setOffline(false);
    const call = network.hold("/v1/rpc/library/write");
    const syncing = phone.replica.sync();
    await call.reached;
    // the kept file went up first, and stays on the device while the write naming it waits
    expect(cell.uploads).toStrictEqual([sha]);
    expect(phone.blobs.held()).toStrictEqual([sha]);
    call.release();
    await syncing;
    expect(cell.item(id)?.blocks.has("i1")).toBe(true);
    expect(phone.blobs.held()).toStrictEqual([]);
    expect(phone.replica.status()).toMatchObject({ parked: [], unsent: 0 });
  });

  it("sends a note's picture again when the cell answers the write that names it BLOB_MISSING", async () => {
    const cell = createFakeCell();
    const network = heldNetwork(cell, "phone");
    const phone = await openDevice(cell, "phone", { network: network.device });
    const id = await landedNote(cell, phone);
    phone.network.setOffline(true);
    const { sha } = await phone.replica.keepFile({ bytes: OTHER_PNG, mime: "image/png" });
    await phone.replica.write(id, { ops: [pictureAt("i1", "a2", sha)] });
    phone.network.setOffline(false);
    const call = network.hold("/v1/rpc/library/write");
    const syncing = phone.replica.sync();
    await call.reached;
    // the cell let the upload go between the two calls
    cell.forgetBlob(sha);
    call.release();
    await syncing;
    await phone.replica.sync();
    expect(cell.uploads).toStrictEqual([sha, sha]);
    expect(cell.item(id)?.blocks.has("i1")).toBe(true);
    expect(phone.blobs.held()).toStrictEqual([]);
    expect(phone.replica.status()).toMatchObject({ parked: [], unsent: 0 });
  });

  it("sends up a kept file no write names, and lets its bytes go", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    const { sha } = await phone.replica.keepFile({ bytes: OTHER_PNG, mime: "image/png" });
    expect(phone.blobs.held()).toStrictEqual([sha]);
    await phone.replica.sync();
    expect(cell.uploads).toStrictEqual([sha]);
    expect(phone.blobs.held()).toStrictEqual([]);
    expect(phone.replica.status()).toMatchObject({ parked: [], unsent: 0 });
  });

  it("counts a kept file as a change of its own once it is parked, for the person to let go", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    await phone.replica.keepFile({ bytes: OTHER_PNG, mime: "image/png" });
    await phone.blobs.clear();
    await phone.replica.sync();
    const { parked, unsent } = phone.replica.status();
    expect(parked).toMatchObject([{ itemIds: [], reason: STAGED_FILE_GONE }]);
    expect(unsent).toBe(1);
    await phone.replica.discard(parked[0]?.seq ?? 0);
    expect(phone.replica.status()).toMatchObject({ parked: [], unsent: 0 });
  });

  it("parks a write whose staged file this device no longer holds", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    await phone.replica.createFile({
      file: { bytes: PNG, mime: "image/png" },
      folderId: null,
      name: "gone.png",
      tags: [],
    });
    await phone.blobs.clear();
    await phone.replica.sync();
    expect(phone.replica.status().parked).toMatchObject([{ reason: STAGED_FILE_GONE }]);
  });
});

describe("the replica's pull", () => {
  it("pulls a page at a time until the cell says there is no more", async () => {
    const cell = createFakeCell();
    const mac = await openDevice(cell, "mac");
    for (const title of ["a", "b", "c", "d", "e"]) {
      await mac.replica.createNote({ blocks: [], folderId: null, tags: [], title });
    }
    await mac.replica.sync();
    cell.setPage(2);
    const phone = await openDevice(cell, "phone");
    await phone.replica.sync();
    expect(cell.calls.filter((call) => call === "phone library/sync/pull")).toHaveLength(3);
    const titles = phone.replica
      .listing({ deleted: false, limit: 10, offset: 0, sort: "title" })
      .items.map((row) => row.title);
    expect(titles).toStrictEqual(["a", "b", "c", "d", "e"]);
    expect(phone.replica.status()).toMatchObject({ cursor: cell.head(), head: cell.head() });
  });

  it("fetches the open item's body first, then the newest", async () => {
    const cell = createFakeCell();
    const mac = await openDevice(cell, "mac");
    const ids: string[] = [];
    for (const title of ["oldest", "middle", "newest"]) {
      ids.push(
        await landedNote(cell, mac).then(async (id) => {
          await write(mac.replica, id, [
            { base: "Plans", field: "title", op: "set", value: title },
          ]);
          await mac.replica.sync();
          return id;
        }),
      );
    }
    cell.setBodiesPerAnswer(1);
    const phone = await openDevice(cell, "phone");
    const [oldest, middle, newest] = ids;
    phone.replica.focus(oldest ?? null);
    await phone.replica.sync();
    const asked = cell.calls.filter((call) => call === "phone library/sync/bodies");
    expect(asked).toHaveLength(3);
    await expect(phone.replica.item(oldest ?? "")).resolves.toMatchObject({ bodyHeld: true });
    await expect(phone.replica.item(middle ?? "")).resolves.toMatchObject({ bodyHeld: true });
    await expect(phone.replica.item(newest ?? "")).resolves.toMatchObject({ bodyHeld: true });
    expect(phone.replica.status().bodies).toStrictEqual({ fetched: 3, total: 3 });
  });

  it("lists a pulled row before its body arrives, under the card the cell sent", async () => {
    const cell = createFakeCell();
    const mac = await openDevice(cell, "mac");
    const id = await landedNote(cell, mac);
    cell.setBodiesPerAnswer(0);
    const phone = await openDevice(cell, "phone");
    await phone.replica.sync();
    expect(phone.replica.row(id)?.title).toBe("Plans");
    expect(phone.replica.row(id)?.card.preview).toBe("first");
    await expect(phone.replica.item(id)).resolves.toMatchObject({ blocks: [], bodyHeld: false });
    cell.setBodiesPerAnswer(1000);
    await phone.replica.sync();
    await expect(replicaText(phone.replica, id, "p2")).resolves.toBe("second");
  });

  it("starts over in another library's epoch, keeping the unsent writes", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    const id = await landedNote(cell, phone);
    cell.tooLarge.add(id);
    await write(phone.replica, id, [await putText(phone.replica, id, "p1", "still mine")]);
    await phone.replica.sync();
    expect(phone.replica.status().parked).toHaveLength(1);
    cell.startOver();
    const changes: boolean[] = [];
    phone.replica.onChange((change) => {
      changes.push(change.reset);
    });
    await phone.replica.sync();
    expect(changes).toContain(true);
    expect(phone.replica.status()).toMatchObject({ cursor: cell.head(), unsent: 1 });
    await expect(replicaText(phone.replica, id, "p1")).resolves.toBe("still mine");
    await expect(replicaText(phone.replica, id, "p2")).resolves.toBe("second");
  });

  it("starts over from nothing when the database holds a schema of another version", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    await landedNote(cell, phone);
    phone.network.setOffline(true);
    await phone.replica.createNote({ blocks: [], folderId: null, tags: [], title: "unsent" });
    await phone.replica.close();
    await phone.sql.run("UPDATE meta SET v = ? WHERE k = 'schema'", ["an older build's"]);
    const again = await openDevice(cell, "phone", { network: phone.network, sql: phone.sql });
    expect(again.replica.status()).toMatchObject({ cursor: 0, unsent: 0 });
    expect(again.replica.scopes().total).toBe(0);
    const verdict = await phone.sql.exclusive(
      async (tx) => await runPlanAsync(tx, ensureLibrarySchema("replica")),
    );
    expect(verdict.kind).toBe("current");
  });

  it("stops on a revoked sign-in and says so, until it is started again", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    await landedNote(cell, phone);
    cell.signOut();
    await phone.replica.sync();
    expect(phone.replica.status().failure).toStrictEqual({ end: "signed-out", kind: "session" });
    const calls = cell.calls.length;
    await phone.replica.sync();
    expect(cell.calls).toHaveLength(calls);
  });
});

describe("what the screens read", () => {
  it("finds what landed, less what this device deleted", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    const id = await landedNote(cell, phone);
    const hits = await phone.replica.search("second", 10);
    expect(hits.map((hit) => hit.itemId)).toStrictEqual([id]);
    phone.network.setOffline(true);
    await phone.replica.deleteItems([id]);
    await expect(phone.replica.search("second", 10)).resolves.toStrictEqual([]);
  });

  it("answers a saved address the library holds with that item, and lists no second card", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    const first = await phone.replica.saveLink({
      folderId: null,
      tags: [],
      url: "https://example.com/post",
    });
    await phone.replica.sync();
    phone.network.setOffline(true);
    const again = await phone.replica.saveLink({
      folderId: null,
      tags: ["later"],
      url: "https://www.example.com/post?utm_source=feed",
    });
    expect(again).toStrictEqual({ folded: true, id: first.id });
    expect(phone.replica.scopes().total).toBe(1);
    phone.network.setOffline(false);
    await phone.replica.sync();
    expect(cell.items().size).toBe(1);
    expect(phone.replica.row(first.id)?.tags).toStrictEqual(["later"]);
    expect(phone.replica.scopes().total).toBe(1);
  });

  it("shows a highlight this device added before the cell holds it", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    const id = await landedNote(cell, phone);
    phone.network.setOffline(true);
    await phone.replica.write(id, {
      annotations: [
        {
          createdAt: 1_700_000_000,
          id: "h1",
          occurrence: null,
          op: "add",
          parentId: null,
          quote: "first",
          text: "worth keeping",
        },
      ],
      ops: [],
    });
    await expect(phone.replica.annotations(id)).resolves.toMatchObject({
      h1: { quote: "first", source: "user", text: "worth keeping" },
    });
    phone.network.setOffline(false);
    await phone.replica.sync();
    expect(cell.annotation("h1")?.text).toBe("worth keeping");
    await expect(phone.replica.annotations(id)).resolves.toMatchObject({
      h1: { text: "worth keeping" },
    });
  });

  it("forgets every row and unsent write on a wipe", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    await landedNote(cell, phone);
    phone.network.setOffline(true);
    await phone.replica.createFile({
      file: { bytes: PNG, mime: "image/png" },
      folderId: null,
      name: "a.png",
      tags: [],
    });
    await phone.replica.wipe();
    expect(phone.replica.scopes().total).toBe(0);
    expect(phone.replica.status()).toMatchObject({ cursor: 0, unsent: 0 });
    expect(phone.blobs.held()).toStrictEqual([]);
  });
});

describe("the outbox's replay", () => {
  it(
    "lands every write once and in order, whatever the network does, over seeded runs",
    { timeout: 60_000 },
    async () => {
      for (let seed = 1; seed <= 25; seed += 1) {
        const rand = mulberry32(seed);
        const cell = createFakeCell();
        const phone = await openDevice(cell, "phone");
        const mac = await openDevice(cell, "mac");
        const { id } = await phone.replica.createNote({
          blocks: ["p1", "p2", "p3"].map((blockId, index) => ({
            block: paragraph(blockId, "start"),
            ord: `a${String(index)}`,
            section: "note" as const,
          })),
          folderId: null,
          tags: [],
          title: "Shared",
        });
        await phone.replica.sync();
        await mac.replica.sync();
        const phoneWrote = new Map<string, string>();
        let macWrote: string | null = null;
        for (let step = 0; step < 14; step += 1) {
          const move = pick(rand, [
            "write",
            "write",
            "write",
            "mac",
            "offline",
            "lose",
            "sync",
          ] as const);
          if (move === "write") {
            const blockId = pick(rand, ["p1", "p2"]);
            const text = `phone ${String(step)}`;
            await write(phone.replica, id, [await putText(phone.replica, id, blockId, text)]);
            phoneWrote.set(blockId, text);
          } else if (move === "mac") {
            macWrote = `mac ${String(step)}`;
            await mac.replica.sync();
            await write(mac.replica, id, [await putText(mac.replica, id, "p3", macWrote)]);
            await mac.replica.sync();
          } else if (move === "offline") {
            phone.network.setOffline(rand() < 0.5);
          } else if (move === "lose") {
            phone.network.loseAnswers(1);
            await phone.replica.sync();
          } else {
            await phone.replica.sync();
          }
        }
        phone.network.setOffline(false);
        await phone.replica.sync();
        await phone.replica.sync();
        const label = `seed ${String(seed)}`;
        expect(phone.replica.status().unsent, label).toBe(0);
        for (const [blockId, text] of phoneWrote) {
          expect(cellText(cell, id, blockId), label).toBe(text);
          await expect(replicaText(phone.replica, id, blockId), label).resolves.toBe(text);
        }
        expect(cellText(cell, id, "p3"), label).toBe(macWrote ?? "start");
        await expect(replicaText(phone.replica, id, "p3"), label).resolves.toBe(
          macWrote ?? "start",
        );
      }
    },
  );
});

describe("the outbox's changes, one at a time", () => {
  it("sends a write that joined a queued row while a pass chose that row", async () => {
    const cell = createFakeCell();
    const counted = await countedSql();
    const phone = await openDevice(cell, "phone", { sql: counted.sql });
    const id = await landedNote(cell, phone);
    await write(phone.replica, id, [await putText(phone.replica, id, "p1", "one")]);
    const joining = counted.holdNext();
    const second = phone.replica.write(id, {
      ops: [await putText(phone.replica, id, "p1", "two")],
    });
    await joining.reached;
    // a screen's read holds the database: the join queues behind it, then the pass chooses the
    // row the join is about to change
    const screen = deferred();
    const asked = counted.asked();
    const reading = phone.sql.exclusive(async () => {
      await screen.promise;
    });
    joining.release();
    await vi.waitFor(() => {
      expect(counted.asked()).toBe(asked + 2);
    });
    const syncing = phone.replica.sync();
    await nextTurn();
    screen.resolve();
    await reading;
    const joined = await second;
    expect(joined.kind).toBe("queued");
    await syncing;
    await phone.replica.sync();
    expect(cellText(cell, id, "p1")).toBe("two");
    await expect(replicaText(phone.replica, id, "p1")).resolves.toBe("two");
    expect(phone.replica.status()).toMatchObject({ parked: [], unsent: 0 });
  });

  it("keeps the bytes a kept file puts while a landing lets the same bytes go", async () => {
    const cell = createFakeCell();
    const network = heldNetwork(cell, "phone");
    const counted = await countedSql();
    const phone = await openDevice(cell, "phone", { network: network.device, sql: counted.sql });
    const id = await landedNote(cell, phone);
    await phone.replica.createFile({
      file: { bytes: PNG, mime: "image/png" },
      folderId: null,
      name: "diagram.png",
      tags: [],
    });
    const call = network.hold("/v1/rpc/library/items/createFile");
    const syncing = phone.replica.sync();
    await call.reached;
    // the file's item lands behind a screen's read while the same bytes are kept for a note
    const screen = deferred();
    const reading = phone.sql.exclusive(async () => {
      await screen.promise;
    });
    const asked = counted.asked();
    call.release();
    await vi.waitFor(() => {
      expect(counted.asked()).toBe(asked + 1);
    });
    const kept = phone.replica.keepFile({ bytes: PNG, mime: "image/png" });
    await nextTurn();
    screen.resolve();
    await reading;
    const { sha } = await kept;
    await phone.replica.write(id, { ops: [pictureAt("i1", "a2", sha)] });
    await syncing;
    await phone.replica.sync();
    // the landing let its bytes go before the kept file put them back, and they went up again
    // from the device's own copy, which stayed until the write naming them landed
    expect(cell.uploads).toStrictEqual([sha, sha]);
    expect(cell.item(id)?.blocks.has("i1")).toBe(true);
    expect(phone.replica.status()).toMatchObject({ parked: [], unsent: 0 });
    expect(phone.blobs.held()).toStrictEqual([]);
  });
});

describe("a write the cell answered CONFLICT", () => {
  it("keeps this device's move of a block another device edited", async () => {
    const cell = createFakeCell();
    const mac = await openDevice(cell, "mac");
    const phone = await openDevice(cell, "phone");
    const id = await landedNote(cell, mac);
    await phone.replica.sync();
    await write(mac.replica, id, [await putText(mac.replica, id, "p1", "the Mac's")]);
    await mac.replica.sync();
    await write(phone.replica, id, [
      await putText(phone.replica, id, "p1", "the phone's"),
      { baseOrd: "a0", blockId: "p1", op: "move", ord: "a2" },
    ]);
    await phone.replica.sync();
    expect(cellText(cell, id, "p1")).toBe("the Mac's / the phone's");
    expect(cell.item(id)?.blocks.get("p1")?.ord).toBe("a2");
    const moved = await heldBlock(phone.replica, id, "p1");
    expect(moved?.ord).toBe("a2");
    expect(phone.replica.status().unsent).toBe(0);
  });
});

describe("a landing over rows this device has not pulled yet", () => {
  it("restores an item whose address a row the cell has moved on from still holds here", async () => {
    const cell = createFakeCell();
    const mac = await openDevice(cell, "mac");
    const network = heldNetwork(cell, "phone");
    const phone = await openDevice(cell, "phone", { network: network.device });
    const url = "https://example.com/page";
    const first = await phone.replica.saveLink({ folderId: null, tags: [], url });
    await phone.replica.sync();
    await mac.replica.sync();
    await mac.replica.deleteItems([first.id]);
    await mac.replica.sync();
    const second = await mac.replica.saveLink({ folderId: null, tags: [], url });
    await mac.replica.sync();
    await phone.replica.sync();
    expect(phone.replica.row(second.id)?.deletedAt).toBeNull();
    await mac.replica.deleteItems([second.id]);
    await mac.replica.restoreItems([first.id]);
    await mac.replica.sync();

    network.refused.add(PULL);
    await phone.replica.restoreItems([first.id]);
    await phone.replica.sync();
    expect(phone.replica.status()).toMatchObject({ failure: { kind: "unreachable" }, unsent: 0 });
    expect(phone.replica.row(first.id)?.deletedAt).toBeNull();

    network.refused.delete(PULL);
    await phone.replica.sync();
    expect(phone.replica.status()).toMatchObject({ cursor: cell.head(), failure: null });
    expect(phone.replica.row(first.id)?.deletedAt).toBeNull();
    expect(phone.replica.row(second.id)?.deletedAt).not.toBeNull();
  });

  it("retires a write whose landing this device's copy refuses, and lays the cell's row from the pull", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    const id = await landedNote(cell, phone);
    // a landing changes an item's row in place; the pull's row comes at a sequence of its own
    await phone.sql.run(
      `CREATE TRIGGER refuse_landing BEFORE UPDATE OF deleted_at ON items WHEN NEW.seq = OLD.seq
       BEGIN SELECT RAISE(ABORT, 'this copy refuses the landing'); END`,
      [],
    );
    await phone.replica.deleteItems([id]);
    await phone.replica.sync();
    expect(cell.calls.filter((call) => call === "phone library/items/delete")).toHaveLength(1);
    expect(phone.replica.status()).toMatchObject({ cursor: cell.head(), failure: null, unsent: 0 });
    expect(phone.replica.row(id)?.deletedAt).not.toBeNull();
  });
});

describe("a change no resend can pass", () => {
  const folderOn = async (device: TestDevice, name: string): Promise<string> => {
    const id = device.newId();
    await device.replica.writeFolders([{ id, name, op: "create", parentId: null, sort: "a0" }]);
    return id;
  };

  const FOLDER_NAME_HELD =
    "A folder here already has this name. Rename that one and try again, or let this change go.";

  it("parks a folder a sibling holds the name of, while every other write and the pull go on", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    const mac = await openDevice(cell, "mac");
    const note = await landedNote(cell, phone);
    await folderOn(phone, "Reading");
    await phone.replica.sync();
    const clash = await folderOn(phone, "reading");
    await write(phone.replica, note, [await putText(phone.replica, note, "p1", "goes on")]);
    const { id: fromTheMac } = await mac.replica.createNote({
      blocks: [],
      folderId: null,
      tags: [],
      title: "From the Mac",
    });
    await mac.replica.sync();
    await phone.replica.sync();

    expect(phone.replica.status()).toMatchObject({
      failure: null,
      parked: [{ itemIds: [], reason: FOLDER_NAME_HELD }],
      unsent: 1,
    });
    expect(cell.folder(clash)).toBeNull();
    expect(cellText(cell, note, "p1")).toBe("goes on");
    expect(phone.replica.row(fromTheMac)).not.toBeNull();
    expect(phone.replica.folders().map((folder) => folder.name)).toContain("reading");
  });

  it("parks a rename onto a sibling's name, and lets it go", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    await folderOn(phone, "Reading");
    const other = await folderOn(phone, "Later");
    await phone.replica.sync();
    await phone.replica.writeFolders([{ base: "Later", id: other, name: "READING", op: "rename" }]);
    await phone.replica.sync();
    const [parked] = phone.replica.status().parked;
    expect(parked?.reason).toBe(FOLDER_NAME_HELD);

    await phone.replica.discard(parked?.seq ?? 0);
    expect(phone.replica.status()).toMatchObject({ parked: [], unsent: 0 });
    expect(phone.replica.folders().find((folder) => folder.id === other)?.name).toBe("Later");
  });

  it("sends a parked folder again once its name is free, renaming the sibling here", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    const sibling = await folderOn(phone, "Reading");
    await phone.replica.sync();
    const clash = await folderOn(phone, "Reading");
    await phone.replica.sync();
    const [parked] = phone.replica.status().parked;

    await phone.replica.retry(parked?.seq ?? 0);
    await phone.replica.sync();
    expect(phone.replica.status().parked).toHaveLength(1);

    await phone.replica.writeFolders([
      { base: "Reading", id: sibling, name: "Read", op: "rename" },
    ]);
    await phone.replica.sync();
    expect(cell.folder(sibling)?.name).toBe("Read");
    await phone.replica.retry(phone.replica.status().parked[0]?.seq ?? 0);
    await phone.replica.sync();
    expect(phone.replica.status()).toMatchObject({ parked: [], unsent: 0 });
    expect(cell.folder(clash)?.name).toBe("Reading");
  });

  it("holds a folder made under a parked folder behind it", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    await folderOn(phone, "Reading");
    await phone.replica.sync();
    const parent = await folderOn(phone, "Reading");
    const child = phone.newId();
    await phone.replica.writeFolders([
      { id: child, name: "Inside", op: "create", parentId: parent, sort: "a0" },
    ]);
    await phone.replica.sync();
    expect(phone.replica.status()).toMatchObject({ failure: null, unsent: 2 });
    expect(cell.folder(child)).toBeNull();
  });

  it("parks a write whose resends go out unchanged, and pulls all the same", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    const held = await phone.replica.saveLink({
      folderId: null,
      tags: [],
      url: "https://example.com/held",
    });
    const other = await phone.replica.saveLink({
      folderId: null,
      tags: [],
      url: "https://example.com/other",
    });
    await phone.replica.sync();
    await write(phone.replica, other.id, [
      {
        base: "https://example.com/other",
        field: "url",
        op: "set",
        value: "https://example.com/held",
      },
    ]);
    await phone.replica.sync();
    expect(phone.replica.status()).toMatchObject({
      failure: null,
      parked: [{ itemIds: [other.id], reason: "Your library couldn't take this change." }],
    });
    expect(cell.item(other.id)?.fields.url).toBe("https://example.com/other");
    expect(cell.item(held.id)?.fields.url).toBe("https://example.com/held");
    const [parked] = phone.replica.status().parked;
    await phone.replica.discard(parked?.seq ?? 0);
    expect(phone.replica.row(other.id)?.url).toBe("https://example.com/other");
  });

  it("waits out a cell that answers a file's upload unavailable, parking nothing", async () => {
    const cell = createFakeCell();
    const network = cell.device("phone");
    const phone = await openDevice(cell, "phone", {
      network: {
        ...network,
        transport: {
          fetch: async (request) =>
            request.method === "PUT"
              ? new Response(null, { status: 503 })
              : await network.transport.fetch(request),
          origin: network.transport.origin,
        },
      },
    });
    await phone.replica.createFile({
      file: { bytes: PNG, mime: "image/png" },
      folderId: null,
      name: "a.png",
      tags: [],
    });
    await phone.replica.sync();
    expect(phone.replica.status()).toMatchObject({
      failure: { kind: "unreachable" },
      parked: [],
      unsent: 1,
    });
  });
});

describe("a write queued behind a delete", () => {
  it("goes after the delete rather than joining the write before it", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    const id = await landedNote(cell, phone);
    phone.network.setOffline(true);
    await write(phone.replica, id, [await putText(phone.replica, id, "p1", "before")]);
    await phone.replica.deleteItems([id]);
    await write(phone.replica, id, [await putText(phone.replica, id, "p1", "after")]);
    expect(phone.replica.status().unsent).toBe(3);
    phone.network.setOffline(false);
    await phone.replica.sync();
    expect(cellText(cell, id, "p1")).toBe("after");
    expect(cell.item(id)?.fields.deletedAt).not.toBeNull();
  });
});
