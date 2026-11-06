// The replica engine every device runs (`@repo/library-replica`) against the real cell, through the
// Worker's own door as an app's link reaches it: a device credential, `/v1/rpc` and `/v1/blobs`.
// Its SQLite is the browser tab's in-memory driver, held on the suite's node side, since workerd
// loads no sqlite-wasm (`../test-support/remote-replica-sql.ts`); everything else is the engine
// as it ships.

import { openLibraryReplica } from "@repo/library-replica/library-replica";
import type { LibraryReplica } from "@repo/library-replica/library-replica";
import type { BlockMerge, StagedBlobs } from "@repo/library-replica/replica-ports";
import type { LibraryOp } from "@repo/notes/library/block-ops";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  deviceHeaders,
  loginDevice,
  ORIGIN,
  signUpUser,
  userIdOf,
} from "../test-support/cloud-helpers";
import { cellOf, inCell } from "../test-support/library-cell";
import { remoteReplicaSql } from "../test-support/remote-replica-sql";

const textOf = (block: LibraryBlock): string =>
  block.children.map((child) => ("text" in child ? child.text : "")).join("");

const paragraph = (id: string, text: string): LibraryBlock => ({
  children: [{ text }],
  id,
  type: "p",
});

// the editor's diff3 keeps both sides of one paragraph two devices changed; this keeps theirs,
// then mine
const keepBoth: BlockMerge = async ({ base, mine, theirs }) => {
  if (textOf(mine) === textOf(base) || textOf(mine) === textOf(theirs)) {
    return { block: theirs, overlapped: false };
  }
  if (textOf(theirs) === textOf(base)) {
    return { block: mine, overlapped: false };
  }
  return { block: paragraph(theirs.id, `${textOf(theirs)} / ${textOf(mine)}`), overlapped: false };
};

const stagedInMemory = (): StagedBlobs & {
  readonly files: Map<string, Uint8Array<ArrayBuffer>>;
} => {
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  return {
    clear: async () => {
      files.clear();
      await Promise.resolve();
    },
    files,
    put: async (sha, bytes) => {
      files.set(sha, bytes);
      await Promise.resolve();
    },
    read: async (sha) => await Promise.resolve(files.get(sha) ?? null),
    remove: async (sha) => {
      files.delete(sha);
      await Promise.resolve();
    },
  };
};

interface Device {
  readonly replica: LibraryReplica;
  readonly blobs: ReturnType<typeof stagedInMemory>;
  // each `/v1` path the device asked, in order
  readonly asked: string[];
  // the next answer is lost after the Worker acted on its request
  readonly loseAnswer: () => void;
}

let devices = 0;

// a device signed in to the account, its replica in a database of its own
const deviceOn = async (cookie: string, name: string): Promise<Device> => {
  devices += 1;
  const { credential } = await loginDevice(cookie, name);
  const headers = deviceHeaders(credential);
  const asked: string[] = [];
  let lose = false;
  let minted = 0;
  const prefix = devices.toString(16).padStart(4, "0");
  const blobs = stagedInMemory();
  const opening = await openLibraryReplica({
    blobs,
    clock: { after: () => () => {}, now: () => Date.now() },
    dial: null,
    merge: keepBoth,
    newId: () => {
      minted += 1;
      return `0190${prefix}-0000-7000-8000-${minted.toString(16).padStart(12, "0")}`;
    },
    sql: remoteReplicaSql(`${name}-${crypto.randomUUID()}`),
    transport: {
      fetch: async (request) => {
        asked.push(new URL(request.url).pathname);
        const signed = new Request(request);
        for (const [key, value] of Object.entries(headers)) {
          signed.headers.set(key, value);
        }
        const response = await exports.default.fetch(signed);
        if (lose) {
          lose = false;
          await response.arrayBuffer();
          throw new TypeError("the answer was lost");
        }
        return response;
      },
      origin: ORIGIN,
    },
  });
  if (opening.kind !== "ready") {
    throw new Error(`the replica did not open on SQLite ${opening.sqliteVersion}`);
  }
  return {
    asked,
    blobs,
    loseAnswer: () => {
      lose = true;
    },
    replica: opening.replica,
  };
};

const account = async (label: string) => {
  const { cookie } = await signUpUser(`replica-${label}-${crypto.randomUUID()}@example.com`);
  return { accountId: await userIdOf(cookie), cookie };
};

const writesBy = (device: Device): number =>
  device.asked.filter((path) => path === "/v1/rpc/library/write").length;

const heldBlock = async (replica: LibraryReplica, itemId: string, blockId: string) => {
  const item = await replica.item(itemId);
  return item?.blocks.find((held) => held.block.id === blockId);
};

const textIn = async (replica: LibraryReplica, itemId: string, blockId: string) => {
  const block = await heldBlock(replica, itemId, blockId);
  return block === undefined ? null : textOf(block.block);
};

const putText = async (
  replica: LibraryReplica,
  itemId: string,
  blockId: string,
  text: string,
): Promise<LibraryOp> => {
  const block = await heldBlock(replica, itemId, blockId);
  if (block === undefined) {
    throw new Error(`no block ${blockId} to put`);
  }
  return { baseHash: block.hash, block: paragraph(blockId, text), op: "put" };
};

const write = async (replica: LibraryReplica, itemId: string, ops: readonly LibraryOp[]) => {
  const outcome = await replica.write(itemId, { ops });
  expect(outcome.kind).toBe("queued");
};

// a note of two paragraphs the laptop made, landed, and pulled by the phone
const sharedNote = async (laptop: Device, phone: Device): Promise<string> => {
  const { id } = await laptop.replica.createNote({
    blocks: [
      { block: paragraph("p1", "first"), ord: "a0", section: "note" },
      { block: paragraph("p2", "second"), ord: "a1", section: "note" },
    ],
    folderId: null,
    tags: [],
    title: "Plans",
  });
  await laptop.replica.sync();
  await phone.replica.sync();
  return id;
};

describe("the replica engine against the account's cell", () => {
  it("pulls another device's item, its row and then its body", { timeout: 30_000 }, async () => {
    const { cookie } = await account("pull");
    const laptop = await deviceOn(cookie, "Laptop");
    const phone = await deviceOn(cookie, "Phone");
    const id = await sharedNote(laptop, phone);
    expect(phone.replica.row(id)).toMatchObject({ title: "Plans", unsent: false });
    await expect(phone.replica.item(id)).resolves.toMatchObject({ bodyHeld: true });
    await expect(textIn(phone.replica, id, "p2")).resolves.toBe("second");
    const hits = await phone.replica.search("second", 10);
    expect(hits.map((hit) => hit.itemId)).toStrictEqual([id]);
    expect(phone.replica.status()).toMatchObject({ failure: null, unsent: 0 });
    expect(phone.replica.status().cursor).toBe(laptop.replica.status().cursor);
  });

  it(
    "starts over when the library's epoch moves, keeping a write it has not sent",
    { timeout: 30_000 },
    async () => {
      const { accountId, cookie } = await account("epoch");
      const laptop = await deviceOn(cookie, "Laptop");
      const phone = await deviceOn(cookie, "Phone");
      const id = await sharedNote(laptop, phone);
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
      const file = await phone.replica.createFile({
        file: { bytes, mime: "image/png" },
        folderId: null,
        name: "diagram.png",
        tags: [],
      });
      // the bytes are gone from the device, so the make parks rather than goes
      await phone.blobs.clear();
      await phone.replica.sync();
      expect(phone.replica.status().parked).toHaveLength(1);

      await inCell(cellOf(accountId), (state) => {
        state.storage.sql.exec("UPDATE meta SET v = ? WHERE k = 'epoch'", "a-restored-library");
      });
      const resets: boolean[] = [];
      phone.replica.onChange((change) => {
        resets.push(change.reset);
      });
      await phone.replica.sync();
      expect(resets).toContain(true);
      expect(phone.replica.status()).toMatchObject({ unsent: 1 });
      expect(phone.replica.row(file.id)?.unsent).toBe(true);
      await expect(textIn(phone.replica, id, "p1")).resolves.toBe("first");

      await phone.blobs.put(file.sha, bytes, "image/png");
      const [parked] = phone.replica.status().parked;
      await phone.replica.retry(parked?.seq ?? 0);
      await phone.replica.sync();
      expect(phone.replica.status().unsent).toBe(0);
      await laptop.replica.sync();
      expect(laptop.replica.row(file.id)).toMatchObject({ kind: "image" });
    },
  );

  it("lands a write whose answer was lost once, and once only", { timeout: 30_000 }, async () => {
    const { cookie } = await account("replay");
    const laptop = await deviceOn(cookie, "Laptop");
    const phone = await deviceOn(cookie, "Phone");
    const id = await sharedNote(laptop, phone);
    await write(phone.replica, id, [await putText(phone.replica, id, "p1", "once")]);
    phone.loseAnswer();
    await phone.replica.sync();
    expect(phone.replica.status().failure?.kind).toBe("unreachable");
    // the write landed though its answer never came
    await laptop.replica.sync();
    await expect(textIn(laptop.replica, id, "p1")).resolves.toBe("once");
    const { cursor } = laptop.replica.status();
    await phone.replica.sync();
    expect(phone.replica.status()).toMatchObject({ cursor, failure: null, unsent: 0 });
    expect(writesBy(phone)).toBe(2);
    // the resend was answered from the write that landed, so it moved the library no further
    await laptop.replica.sync();
    expect(laptop.replica.status().cursor).toBe(cursor);
  });

  it(
    "lands two devices' edits to different blocks of one item with no round trip",
    { timeout: 30_000 },
    async () => {
      const { cookie } = await account("blocks");
      const laptop = await deviceOn(cookie, "Laptop");
      const phone = await deviceOn(cookie, "Phone");
      const id = await sharedNote(laptop, phone);
      await write(laptop.replica, id, [await putText(laptop.replica, id, "p1", "the laptop's")]);
      await laptop.replica.sync();
      await write(phone.replica, id, [await putText(phone.replica, id, "p2", "the phone's")]);
      await phone.replica.sync();
      expect(writesBy(phone)).toBe(1);
      await expect(textIn(phone.replica, id, "p1")).resolves.toBe("the laptop's");
      await laptop.replica.sync();
      await expect(textIn(laptop.replica, id, "p2")).resolves.toBe("the phone's");
    },
  );

  it(
    "merges two devices' edits to one block through the merge port, and sends it again",
    { timeout: 30_000 },
    async () => {
      const { cookie } = await account("merge");
      const laptop = await deviceOn(cookie, "Laptop");
      const phone = await deviceOn(cookie, "Phone");
      const id = await sharedNote(laptop, phone);
      await write(laptop.replica, id, [await putText(laptop.replica, id, "p1", "the laptop's")]);
      await laptop.replica.sync();
      await write(phone.replica, id, [await putText(phone.replica, id, "p1", "the phone's")]);
      await phone.replica.sync();
      expect(writesBy(phone)).toBe(2);
      expect(phone.replica.status().unsent).toBe(0);
      await laptop.replica.sync();
      await expect(textIn(laptop.replica, id, "p1")).resolves.toBe("the laptop's / the phone's");
      await expect(textIn(phone.replica, id, "p1")).resolves.toBe("the laptop's / the phone's");
    },
  );
});
