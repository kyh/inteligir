// The replica engine every device runs (`@repo/library-replica`) against the real cell, through the
// Worker's own door as an app's link reaches it: a device credential, `/v1/rpc` and `/v1/blobs`.
// Its SQLite is the browser tab's in-memory driver, held on the suite's node side, since workerd
// loads no sqlite-wasm (`../test-support/remote-replica-sql.ts`); everything else is the engine
// as it ships.

import { createItemSession } from "@repo/editor/item/item-session";
import { headlessEditor } from "@repo/editor/markdown/markdown-doc";
import { openLibraryReplica } from "@repo/library-replica/library-replica";
import type { LibraryReplica } from "@repo/library-replica/library-replica";
import type { BlockMerge, ReplicaSql, StagedBlobs } from "@repo/library-replica/replica-ports";
import { deferred } from "@repo/library-replica/test-support/deferred";
import type { LibraryOp } from "@repo/notes/library/block-ops";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import {
  deviceHeaders,
  loginDevice,
  ORIGIN,
  signUpUser,
  userIdOf,
} from "../test-support/cloud-helpers";
import { cellOf, inCell } from "../test-support/library-cell";
import { R2_FAULTS } from "../test-support/library-files";
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

// a read a suite has stopped with its answer in hand, as a slow disk would leave it
interface HeldRead {
  readonly reached: Promise<void>;
  readonly release: () => void;
}

interface Device {
  readonly replica: LibraryReplica;
  readonly blobs: ReturnType<typeof stagedInMemory>;
  // each `/v1` path the device asked, in order
  readonly asked: string[];
  // the next answer is lost after the Worker acted on its request
  readonly loseAnswer: () => void;
  // the next read of this statement waits, its answer in hand, until the suite lets it go
  readonly holdRead: (statement: string) => HeldRead;
}

// a database whose reads a suite can stop one at a time
const holdableSql = (sql: ReplicaSql) => {
  let held: { readonly statement: string; readonly stop: () => Promise<void> } | null = null;
  return {
    holdRead: (statement: string): HeldRead => {
      const reached = deferred();
      const released = deferred();
      held = {
        statement,
        stop: async () => {
          reached.resolve();
          await released.promise;
        },
      };
      return { reached: reached.promise, release: released.resolve };
    },
    sql: {
      ...sql,
      all: async (statement, params) => {
        const rows = await sql.all(statement, params);
        const stopped = held;
        if (stopped !== null && statement.includes(stopped.statement)) {
          held = null;
          await stopped.stop();
        }
        return rows;
      },
    } satisfies ReplicaSql,
  };
};

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
  const { holdRead, sql } = holdableSql(remoteReplicaSql(`${name}-${crypto.randomUUID()}`));
  const opening = await openLibraryReplica({
    blobs,
    clock: { after: () => () => {}, now: () => Date.now() },
    dial: null,
    merge: keepBoth,
    newId: () => {
      minted += 1;
      return `0190${prefix}-0000-7000-8000-${minted.toString(16).padStart(12, "0")}`;
    },
    sql,
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
    holdRead,
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

// the device's editor over an item, as a host opens it, each pause ended by the suite's hand
const openOn = async (device: Device, itemId: string) => {
  const editor = headlessEditor();
  let pause: (() => void) | null = null;
  const session = createItemSession(itemId, editor, {
    after: (_ms, run) => {
      pause = run;
      return () => {
        pause = null;
      };
    },
    notifyOverlap: () => {},
    store: device.replica,
  });
  await session.start();
  return {
    // what the session makes of a change it has heard, written or read
    caughtUp: async () => {
      await session.read();
    },
    editor,
    endPause: () => {
      pause?.();
    },
    session,
    words: () => JSON.stringify(editor.children),
  };
};

// a link two devices saved apart: the phone's card still to go, the laptop's landed with a note
const heldAddress = async (phone: Device, laptop: Device) => {
  const url = "https://example.com/article";
  const card = await phone.replica.saveLink({ folderId: null, tags: [], url });
  const holder = await laptop.replica.saveLink({ folderId: null, tags: [], url });
  await write(laptop.replica, holder.id, [
    { block: paragraph("kept", "months of notes"), op: "insert", ord: "a0", section: "note" },
  ]);
  await laptop.replica.sync();
  return { card, holder };
};

const folderMade = async (device: Device, id: string, name: string): Promise<string> => {
  await device.replica.writeFolders([{ id, name, op: "create", parentId: null, sort: "a0" }]);
  return id;
};

// a folder parked for a name a sibling holds, and everything a person files in it meanwhile
const filedInParkedFolder = async (phone: Device, laptop: Device) => {
  const moved = await sharedNote(laptop, phone);
  const sibling = await folderMade(phone, "0190ffff-0000-7000-8000-000000000011", "Reading");
  await phone.replica.sync();
  const folderId = await folderMade(phone, "0190ffff-0000-7000-8000-000000000012", "reading");
  const child = "0190ffff-0000-7000-8000-000000000013";
  await phone.replica.writeFolders([
    { id: child, name: "Inside", op: "create", parentId: folderId, sort: "a0" },
  ]);
  const note = await phone.replica.createNote({
    blocks: [],
    folderId,
    tags: [],
    title: "Filed note",
  });
  const link = await phone.replica.saveLink({
    folderId,
    tags: [],
    url: "https://example.com/filed-link",
  });
  const file = await phone.replica.createFile({
    file: { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 4]), mime: "image/png" },
    folderId,
    name: "filed.png",
    tags: [],
  });
  const page = await phone.replica.savePage({
    article: [{ block: paragraph("a1", "read here"), ord: "a0" }],
    cover: null,
    facts: { author: null, description: null, lang: null, published: null, site: null },
    folderId,
    selection: null,
    tags: [],
    title: "Filed page",
    url: "https://example.com/filed-page",
  });
  await write(phone.replica, moved, [
    { base: null, field: "folderId", op: "set", value: folderId },
  ]);
  await phone.replica.writeFolders([
    { base: "reading", id: folderId, name: "reading list", op: "rename" },
  ]);
  return { child, folderId, items: [note.id, link.id, file.id, page.id, moved], sibling };
};

describe("the replica engine against the account's cell", () => {
  it("lists a make before it lands as the cell lands it", { timeout: 30_000 }, async () => {
    const { cookie } = await account("made");
    const phone = await deviceOn(cookie, "Phone");
    const link = await phone.replica.saveLink({
      folderId: null,
      tags: [],
      url: "https://youtu.be/x?utm_source=a",
    });
    const picture = await phone.replica.createFile({
      file: { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 7, 8, 9]), mime: "image/png" },
      folderId: null,
      name: "scan",
      tags: [],
    });
    const shown = (id: string) => {
      const row = phone.replica.row(id);
      return { cover: row?.fields.coverSha, kind: row?.kind, title: row?.title, url: row?.url };
    };
    const before = [shown(link.id), shown(picture.id)];
    expect(before).toMatchObject([{ kind: "video" }, { cover: picture.sha, kind: "image" }]);

    await phone.replica.sync();
    expect(phone.replica.status()).toMatchObject({ failure: null, parked: [], unsent: 0 });
    expect([shown(link.id), shown(picture.id)]).toStrictEqual(before);
  });

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

  it.each(R2_FAULTS)(
    "keeps a file R2 could not store to send again, and parks nothing: %s",
    { timeout: 30_000 },
    async (_, fault) => {
      const { cookie } = await account("r2-fault");
      const phone = await deviceOn(cookie, "Phone");
      const storage = vi.spyOn(env.BLOBS, "put").mockRejectedValue(fault);
      const file = await phone.replica.createFile({
        file: { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9]), mime: "image/png" },
        folderId: null,
        name: "receipt.png",
        tags: [],
      });
      await phone.replica.sync();
      expect(phone.replica.status()).toMatchObject({ parked: [], unsent: 1 });
      expect(phone.replica.status().failure).toMatchObject({ kind: "unreachable" });

      storage.mockRestore();
      await phone.replica.sync();
      expect(phone.replica.status()).toMatchObject({ failure: null, parked: [], unsent: 0 });
      expect(phone.replica.row(file.id)).toMatchObject({ kind: "image", unsent: false });
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

  it(
    "parks a folder a sibling holds the name of, and goes on with every other write and the pull",
    { timeout: 30_000 },
    async () => {
      const { cookie } = await account("namesake");
      const laptop = await deviceOn(cookie, "Laptop");
      const phone = await deviceOn(cookie, "Phone");
      const id = await sharedNote(laptop, phone);
      const newFolder = async (name: string, minted: string): Promise<string> => {
        await phone.replica.writeFolders([
          { id: minted, name, op: "create", parentId: null, sort: "a0" },
        ]);
        return minted;
      };
      const sibling = await newFolder("Reading", "0190ffff-0000-7000-8000-000000000001");
      await phone.replica.sync();
      await newFolder("reading", "0190ffff-0000-7000-8000-000000000002");
      await write(phone.replica, id, [await putText(phone.replica, id, "p1", "goes on")]);
      await write(laptop.replica, id, [await putText(laptop.replica, id, "p2", "comes in")]);
      await laptop.replica.sync();
      await phone.replica.sync();

      expect(phone.replica.status()).toMatchObject({ failure: null, unsent: 1 });
      const [parked] = phone.replica.status().parked;
      expect(parked?.reason).toContain("already has this name");
      await expect(textIn(phone.replica, id, "p2")).resolves.toBe("comes in");
      await laptop.replica.sync();
      await expect(textIn(laptop.replica, id, "p1")).resolves.toBe("goes on");

      await phone.replica.writeFolders([
        { base: "Reading", id: sibling, name: "Read", op: "rename" },
      ]);
      await phone.replica.sync();
      await phone.replica.retry(parked?.seq ?? 0);
      await phone.replica.sync();
      expect(phone.replica.status()).toMatchObject({ parked: [], unsent: 0 });
      await laptop.replica.sync();
      expect(
        laptop.replica
          .folders()
          .map((folder) => folder.name)
          .toSorted(),
      ).toStrictEqual(["Read", "reading"]);
    },
  );

  it(
    "lands what was written on a saved card on the item the cell folded the save onto",
    { timeout: 30_000 },
    async () => {
      const { cookie } = await account("fold");
      const laptop = await deviceOn(cookie, "Laptop");
      const phone = await deviceOn(cookie, "Phone");
      const url = "https://example.com/article";
      const card = await phone.replica.saveLink({ folderId: null, tags: [], url });
      const holder = await laptop.replica.saveLink({ folderId: null, tags: [], url });
      await laptop.replica.sync();
      await write(phone.replica, card.id, [
        { block: paragraph("n1", "my note"), op: "insert", ord: "a0", section: "note" },
      ]);
      await phone.replica.sync();

      expect(phone.replica.status()).toMatchObject({ failure: null, parked: [], unsent: 0 });
      expect(phone.replica.row(card.id)).toBeNull();
      await expect(textIn(phone.replica, holder.id, "n1")).resolves.toBe("my note");
      await laptop.replica.sync();
      await expect(textIn(laptop.replica, holder.id, "n1")).resolves.toBe("my note");
    },
  );

  it(
    "holds what is filed in a parked folder behind it, and files it there once it lands",
    { timeout: 30_000 },
    async () => {
      const { cookie } = await account("parked-filed");
      const laptop = await deviceOn(cookie, "Laptop");
      const phone = await deviceOn(cookie, "Phone");
      const { child, folderId, items, sibling } = await filedInParkedFolder(phone, laptop);
      await phone.replica.sync();

      expect(phone.replica.status()).toMatchObject({ failure: null, unsent: 8 });
      expect(phone.replica.status().parked).toHaveLength(1);
      await laptop.replica.sync();
      const [moved] = items.slice(-1);
      expect(items.slice(0, -1).map((id) => laptop.replica.row(id))).toStrictEqual([
        null,
        null,
        null,
        null,
      ]);
      expect(laptop.replica.row(moved ?? "")?.folderId).toBeNull();

      await phone.replica.writeFolders([
        { base: "Reading", id: sibling, name: "Read", op: "rename" },
      ]);
      await phone.replica.sync();
      const [parked] = phone.replica.status().parked;
      await phone.replica.retry(parked?.seq ?? 0);
      await phone.replica.sync();

      expect(phone.replica.status()).toMatchObject({ failure: null, parked: [], unsent: 0 });
      await laptop.replica.sync();
      expect(items.map((id) => laptop.replica.row(id)?.folderId)).toStrictEqual(
        items.map(() => folderId),
      );
      expect(laptop.replica.folders().find((held) => held.id === child)?.parentId).toBe(folderId);
    },
  );

  it(
    "lands what was filed in a folder the person lets go unfiled, parking nothing",
    { timeout: 30_000 },
    async () => {
      const { cookie } = await account("parked-gone");
      const laptop = await deviceOn(cookie, "Laptop");
      const phone = await deviceOn(cookie, "Phone");
      const { child, folderId, items } = await filedInParkedFolder(phone, laptop);
      await phone.replica.sync();
      const [parked] = phone.replica.status().parked;

      await phone.replica.discard(parked?.seq ?? 0);
      expect(items.map((id) => phone.replica.row(id)?.folderId)).toStrictEqual(
        items.map(() => null),
      );
      await phone.replica.sync();

      expect(phone.replica.status()).toMatchObject({ failure: null, parked: [], unsent: 0 });
      await laptop.replica.sync();
      expect(items.map((id) => laptop.replica.row(id)?.folderId)).toStrictEqual(
        items.map(() => null),
      );
      expect(laptop.replica.folders().some((held) => held.id === folderId)).toBe(false);
      expect(laptop.replica.folders().find((held) => held.id === child)?.parentId).toBeNull();
    },
  );

  it(
    "keeps sending what is filed in a folder whose rename parked, since that folder stands",
    { timeout: 30_000 },
    async () => {
      const { cookie } = await account("parked-rename");
      const laptop = await deviceOn(cookie, "Laptop");
      const phone = await deviceOn(cookie, "Phone");
      await folderMade(phone, "0190ffff-0000-7000-8000-000000000021", "Reading");
      const folderId = await folderMade(phone, "0190ffff-0000-7000-8000-000000000022", "Later");
      await phone.replica.sync();
      await phone.replica.writeFolders([
        { base: "Later", id: folderId, name: "reading", op: "rename" },
      ]);
      const note = await phone.replica.createNote({
        blocks: [],
        folderId,
        tags: [],
        title: "Filed note",
      });
      await phone.replica.sync();

      expect(phone.replica.status().parked).toHaveLength(1);
      await laptop.replica.sync();
      expect(laptop.replica.row(note.id)?.folderId).toBe(folderId);
    },
  );

  it(
    "keeps a card open through its fold, its unsaved words going on to the item at its address",
    { timeout: 30_000 },
    async () => {
      const { cookie } = await account("fold-open");
      const laptop = await deviceOn(cookie, "Laptop");
      const phone = await deviceOn(cookie, "Phone");
      const { card, holder } = await heldAddress(phone, laptop);
      const open = await openOn(phone, card.id);

      open.editor.tf.insertNodes(paragraph("n1", "written"), { at: [0] });
      open.session.edited();
      open.endPause();
      await open.caughtUp();
      open.editor.tf.insertText(" and typing", { at: { offset: 7, path: [0, 0] } });
      open.session.edited();
      await phone.replica.sync();
      await open.caughtUp();

      expect(open.session.status()).toMatchObject({ kind: "open", unsaved: true });
      expect(open.words()).toContain("written and typing");
      expect(open.words()).toContain("months of notes");

      open.endPause();
      await open.caughtUp();
      await phone.replica.sync();
      expect(open.session.status()).toMatchObject({ kind: "open", unsaved: false });
      expect(phone.replica.status()).toMatchObject({ failure: null, parked: [], unsent: 0 });
      await laptop.replica.sync();
      await expect(textIn(laptop.replica, holder.id, "n1")).resolves.toBe("written and typing");
      await expect(textIn(laptop.replica, holder.id, "kept")).resolves.toBe("months of notes");
    },
  );

  it(
    "answers a card's id as the item it folded onto, for a screen that still holds it",
    { timeout: 30_000 },
    async () => {
      const { cookie } = await account("fold-id");
      const laptop = await deviceOn(cookie, "Laptop");
      const phone = await deviceOn(cookie, "Phone");
      const { card, holder } = await heldAddress(phone, laptop);
      const heard: boolean[] = [];
      phone.replica.onChange((change) => {
        heard.push(change.ids.has(card.id));
      });
      await phone.replica.sync();

      await expect(phone.replica.item(card.id)).resolves.toMatchObject({ id: holder.id });
      expect(phone.replica.row(card.id)).toBeNull();

      heard.length = 0;
      await write(laptop.replica, holder.id, [
        await putText(laptop.replica, holder.id, "kept", "moved on"),
      ]);
      await laptop.replica.sync();
      await phone.replica.sync();
      expect(heard).toContain(true);
      await expect(textIn(phone.replica, card.id, "kept")).resolves.toBe("moved on");
    },
  );

  it(
    "lands a write past its check on the item the card folded onto, parking nothing",
    { timeout: 30_000 },
    async () => {
      const { cookie } = await account("fold-race");
      const laptop = await deviceOn(cookie, "Laptop");
      const phone = await deviceOn(cookie, "Phone");
      const { card, holder } = await heldAddress(phone, laptop);

      const check = phone.holdRead("SELECT item_id FROM body_wants");
      const writing = phone.replica.write(card.id, {
        ops: [{ block: paragraph("n1", "just in"), op: "insert", ord: "a1", section: "note" }],
      });
      await check.reached;
      await phone.replica.sync();
      check.release();
      await expect(writing).resolves.toMatchObject({ kind: "queued" });
      await phone.replica.sync();

      expect(phone.replica.status()).toMatchObject({ failure: null, parked: [], unsent: 0 });
      await laptop.replica.sync();
      await expect(textIn(laptop.replica, holder.id, "n1")).resolves.toBe("just in");
    },
  );

  it(
    "drops a delete of a card that folded, leaving the item at its address where it is",
    { timeout: 30_000 },
    async () => {
      const { cookie } = await account("fold-delete");
      const laptop = await deviceOn(cookie, "Laptop");
      const phone = await deviceOn(cookie, "Phone");
      const { card, holder } = await heldAddress(phone, laptop);
      await write(phone.replica, card.id, [
        { block: paragraph("n1", "my note"), op: "insert", ord: "a1", section: "note" },
      ]);
      const other = await phone.replica.createNote({
        blocks: [],
        folderId: null,
        tags: [],
        title: "Going too",
      });
      await phone.replica.deleteItems([card.id, other.id]);
      await phone.replica.sync();

      expect(phone.replica.status()).toMatchObject({ failure: null, parked: [], unsent: 0 });
      expect(phone.replica.row(holder.id)?.deletedAt).toBeNull();
      expect(phone.replica.row(other.id)?.deletedAt).not.toBeNull();
      await laptop.replica.sync();
      expect(laptop.replica.row(holder.id)?.deletedAt).toBeNull();
      expect(laptop.replica.row(other.id)?.deletedAt).not.toBeNull();
      await expect(textIn(laptop.replica, holder.id, "n1")).resolves.toBe("my note");
      await expect(textIn(laptop.replica, holder.id, "kept")).resolves.toBe("months of notes");
    },
  );

  it(
    "goes no further with a delete a screen asks of a card already folded",
    { timeout: 30_000 },
    async () => {
      const { cookie } = await account("fold-late-delete");
      const laptop = await deviceOn(cookie, "Laptop");
      const phone = await deviceOn(cookie, "Phone");
      const { card, holder } = await heldAddress(phone, laptop);
      await phone.replica.sync();

      await phone.replica.deleteItems([card.id]);
      expect(phone.replica.status()).toMatchObject({ parked: [], unsent: 0 });
      await phone.replica.sync();
      expect(phone.replica.row(holder.id)?.deletedAt).toBeNull();
      expect(phone.asked.filter((path) => path.endsWith("/items/delete"))).toHaveLength(0);
    },
  );

  it(
    "parks a restore of an address another item holds, and asks again once it is free",
    { timeout: 30_000 },
    async () => {
      const { cookie } = await account("restore");
      const phone = await deviceOn(cookie, "Phone");
      const url = "https://example.com/article";
      const deleted = await phone.replica.saveLink({ folderId: null, tags: [], url });
      await phone.replica.sync();
      await phone.replica.deleteItems([deleted.id]);
      await phone.replica.sync();
      const holder = await phone.replica.saveLink({ folderId: null, tags: [], url });
      await phone.replica.sync();

      await phone.replica.restoreItems([deleted.id]);
      await phone.replica.sync();
      expect(phone.replica.status()).toMatchObject({ failure: null, unsent: 1 });
      const [parked] = phone.replica.status().parked;
      expect(parked).toMatchObject({ itemIds: [deleted.id] });

      await phone.replica.deleteItems([holder.id]);
      await phone.replica.sync();
      await phone.replica.retry(parked?.seq ?? 0);
      await phone.replica.sync();
      expect(phone.replica.status()).toMatchObject({ parked: [], unsent: 0 });
      expect(phone.replica.row(deleted.id)?.deletedAt).toBeNull();
      expect(phone.replica.row(holder.id)?.deletedAt).not.toBeNull();
    },
  );
});
