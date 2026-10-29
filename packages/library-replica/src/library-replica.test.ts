import { blockHash } from "@repo/notes/library/block-hash";
import type { LibraryOp } from "@repo/notes/library/block-ops";
import { ensureLibrarySchema } from "@repo/notes/library/library-schema";
import { runPlanAsync } from "@repo/notes/library/library-sql";
import { mulberry32, pick } from "@repo/notes/test-support/seeded-random";
import { describe, expect, it } from "vitest";

import { fileSha } from "./library-replica";
import { STAGED_FILE_GONE } from "./outbox";
import type { LibraryReplica } from "./library-replica";
import { createFakeCell } from "./test-support/fake-cell";
import type { FakeCell } from "./test-support/fake-cell";
import { openDevice, paragraph, relaunch, textOf } from "./test-support/replica-harness";
import type { TestDevice } from "./test-support/replica-harness";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const OTHER_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 5, 6]);

const writes = (cell: FakeCell, device: string): number =>
  cell.calls.filter((call) => call === `${device} library/write`).length;

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
    expect(await replicaText(again.replica, id, "p1")).toBe("draft, edited");

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
    expect(outcome.kind).toBe("changed");
    if (outcome.kind === "changed") {
      expect(outcome.item.blocks.map((held) => textOf(held.block))).toEqual(["first", "second"]);
    }
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
    expect(await replicaText(phone.replica, id, "p1")).toBe("the Mac's");
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
    expect(await replicaText(phone.replica, id, "p1")).toBe("the Mac's / the phone's");
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
    expect(await replicaText(phone.replica, id, "p2")).toBe("edited on the Mac");
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
    expect(await replicaText(phone.replica, big, "p1")).toBe("far too much");
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
    expect(await replicaText(phone.replica, id, "p1")).toBe("first");
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
    expect(live.items.map((row) => [row.id, row.unsent, row.tags])).toEqual([
      [id, true, ["drafts"]],
    ]);
    const deleted = phone.replica.listing({ deleted: true, limit: 10, offset: 0, sort: "saved" });
    expect(deleted.items.map((row) => row.id)).toEqual([landed]);
    expect(phone.replica.folders().map((folder) => folder.name)).toEqual(["Reading"]);

    phone.network.setOffline(false);
    await phone.replica.sync();
    expect(cell.item(landed)?.fields.deletedAt).not.toBeNull();
    expect(cell.folder(folderId)?.name).toBe("Reading");
    expect(phone.replica.folders().map((folder) => folder.name)).toEqual(["Reading"]);
    expect(phone.replica.row(id)?.unsent).toBe(false);
  });

  it("uploads a file before the item that names it, and again when the cell says it is missing", async () => {
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
    expect(cell.uploads).toEqual([file.sha]);
    expect(cell.item(file.id)?.fields.originalSha).toBe(file.sha);
    expect(phone.blobs.held()).toEqual([]);

    const id = await landedNote(cell, phone);
    const image = (blockId: string, ord: string): LibraryOp => ({
      block: { children: [{ text: "" }], id: blockId, sha: fileSha(OTHER_PNG), type: "img" },
      op: "insert",
      ord,
      section: "note",
    });
    await phone.replica.write(id, {
      files: [{ bytes: OTHER_PNG, mime: "image/png" }],
      ops: [image("i1", "a2")],
    });
    await phone.replica.sync();
    cell.forgetBlob(fileSha(OTHER_PNG));
    await phone.replica.write(id, {
      files: [{ bytes: OTHER_PNG, mime: "image/png" }],
      ops: [image("i2", "a3")],
    });
    await phone.replica.sync();
    expect(cell.uploads).toEqual([file.sha, fileSha(OTHER_PNG), fileSha(OTHER_PNG)]);
    expect(cell.item(id)?.blocks.has("i2")).toBe(true);
    expect(phone.replica.status().unsent).toBe(0);
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
    expect(titles).toEqual(["a", "b", "c", "d", "e"]);
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
    expect(await phone.replica.item(oldest ?? "")).toMatchObject({ bodyHeld: true });
    expect(await phone.replica.item(middle ?? "")).toMatchObject({ bodyHeld: true });
    expect(await phone.replica.item(newest ?? "")).toMatchObject({ bodyHeld: true });
    expect(phone.replica.status().bodies).toEqual({ fetched: 3, total: 3 });
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
    expect(await phone.replica.item(id)).toMatchObject({ blocks: [], bodyHeld: false });
    cell.setBodiesPerAnswer(1000);
    await phone.replica.sync();
    expect(await replicaText(phone.replica, id, "p2")).toBe("second");
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
    expect(await replicaText(phone.replica, id, "p1")).toBe("still mine");
    expect(await replicaText(phone.replica, id, "p2")).toBe("second");
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
    expect(phone.replica.status().failure).toEqual({ end: "signed-out", kind: "session" });
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
    expect(hits.map((hit) => hit.itemId)).toEqual([id]);
    phone.network.setOffline(true);
    await phone.replica.deleteItems([id]);
    expect(await phone.replica.search("second", 10)).toEqual([]);
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
    expect(again).toEqual({ folded: true, id: first.id });
    expect(phone.replica.scopes().total).toBe(1);
    phone.network.setOffline(false);
    await phone.replica.sync();
    expect(cell.items().size).toBe(1);
    expect(phone.replica.row(first.id)?.tags).toEqual(["later"]);
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
    expect(await phone.replica.annotations(id)).toMatchObject({
      h1: { quote: "first", source: "user", text: "worth keeping" },
    });
    phone.network.setOffline(false);
    await phone.replica.sync();
    expect(cell.annotation("h1")?.text).toBe("worth keeping");
    expect(await phone.replica.annotations(id)).toMatchObject({ h1: { text: "worth keeping" } });
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
    expect(phone.blobs.held()).toEqual([]);
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
          expect(await replicaText(phone.replica, id, blockId), label).toBe(text);
        }
        expect(cellText(cell, id, "p3"), label).toBe(macWrote ?? "start");
        expect(await replicaText(phone.replica, id, "p3"), label).toBe(macWrote ?? "start");
      }
    },
  );
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
