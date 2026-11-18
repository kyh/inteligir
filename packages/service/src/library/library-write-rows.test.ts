// The library's rows that write, over Postgres: called in process as a principal calls them, so
// every input and output meets the contract's own schemas and every refusal arrives as the error
// its row declares, and once over `/v1/rpc` as a tab calls it.

import { randomUUID } from "node:crypto";

import type { BodyBlock } from "@repo/contract/library/derive-item";
import { BLOCK_MAX_BYTES } from "@repo/contract/library/library-nodes";
import { isOrpcError } from "@repo/contract/rpc/v1-errors";
import { noteFixture, paragraph, pillParagraph } from "@repo/contract/test-support/library-items";
import { db } from "@repo/db/drizzle-client";
import {
  file,
  folder,
  item,
  itemBody,
  itemFile,
  itemSearch,
  itemTag,
  libraryState,
  purgedItem,
} from "@repo/db/library-schema";
import { dbSuite } from "@repo/db/test-database";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { signUpUser, userIdOf } from "../test-support/auth-requests";
import {
  libraryAs,
  makeAccount,
  personalLibrary,
  seedFile,
  seedItem,
  sessionPrincipal,
} from "../test-support/library-fixture";
import { pageHeaders, v1Link } from "../test-support/v1-link";
import { mintLibraryId } from "./library-ids";

const SAVED_AT = 1_700_000_000_000;
const SHA = "a".repeat(64);
const OP_ID = "0190a000-0000-7000-8000-0000000000aa";

const newId = (): string => mintLibraryId(Date.now());

// the refusal a call met, as its client reads it
const refusalOf = async (call: Promise<unknown>) => {
  try {
    await call;
  } catch (error) {
    if (isOrpcError(error)) {
      return { code: error.code, data: error.data, defined: error.defined };
    }
    throw error;
  }
  throw new Error("the call landed what the test expected it to refuse");
};

const codeOf = async (call: Promise<unknown>): Promise<string> => {
  const { code } = await refusalOf(call);
  return code;
};

interface Filing {
  readonly title?: string;
  readonly tags?: string[];
}

// a note a device makes, of lines of text
const noteOf = (lines: readonly string[], filing: Filing = {}) => {
  const id = newId();
  return {
    blocks: lines.map((text, at): BodyBlock => ({
      block: paragraph(`${id}-${String(at)}`, text),
      section: "note",
    })),
    folderId: null,
    id,
    savedAt: SAVED_AT,
    tags: filing.tags ?? [],
    title: filing.title ?? "",
  };
};

type Library = Awaited<ReturnType<typeof personalLibrary>>["library"];

const note = async (library: Library, lines: readonly string[], filing?: Filing) => {
  const made = noteOf(lines, filing);
  await library.items.create(made);
  return made.id;
};

const headOf = async (accountId: string): Promise<number> => {
  const [row] = await db
    .select({ head: libraryState.head })
    .from(libraryState)
    .where(eq(libraryState.accountId, accountId));
  return row?.head ?? 0;
};

const itemCount = async (accountId: string): Promise<number> => {
  const [row] = await db.select({ n: count() }).from(item).where(eq(item.accountId, accountId));
  return row?.n ?? 0;
};

const liveFolders = async (accountId: string) =>
  await db
    .select({ id: folder.id, name: folder.name, parentId: folder.parentId })
    .from(folder)
    .where(and(eq(folder.accountId, accountId), isNull(folder.deletedAt)))
    .orderBy(asc(folder.name));

const propertiesOf = async (library: Library, id: string) => {
  const { fields } = await library.items.row({ id });
  return fields.properties;
};

dbSuite("the library's rows that write", () => {
  it("makes a note through /v1/rpc, and reads it back whole", async () => {
    const { cookie } = await signUpUser("library-create@example.test");
    const tab = v1Link(pageHeaders(cookie));
    const made = noteOf(["Through the wire."], { title: "Wired" });
    const { item: landed } = await tab.library.items.create(made);
    expect(landed).toMatchObject({ fields: { kind: "note", title: "Wired" }, id: made.id });
    await expect(tab.library.items.get({ id: made.id })).resolves.toStrictEqual({
      ...landed,
      blocks: made.blocks,
      bodyVersion: 1,
    });
    const [row] = await db
      .select({ accountId: item.accountId })
      .from(item)
      .where(eq(item.id, made.id));
    expect(row?.accountId).toBe(await userIdOf(cookie));
  });

  describe("what a screen writes beyond its ops", () => {
    it("answers an item whole in reading order and its row without its body, one in Deleted too, and none it lacks", async () => {
      const { library } = await personalLibrary();
      const made = noteOf(["First line.", "Second line."], { title: "Two lines" });
      const { id } = made;
      await library.items.create(made);
      const { blocks, ...row } = await library.items.get({ id });
      expect(row).toMatchObject({ fields: { kind: "note", title: "Two lines" }, id });
      expect(blocks.map(({ block }) => block.id)).toStrictEqual([`${id}-0`, `${id}-1`]);
      expect(row.seq).toBeGreaterThan(0);
      await expect(library.items.row({ id })).resolves.toStrictEqual(row);

      await library.items.delete({ ids: [id] });
      await expect(library.items.get({ id })).resolves.toMatchObject({
        fields: { deletedAt: expect.any(Number) },
      });
      const stranger = newId();
      await expect(codeOf(library.items.get({ id: stranger }))).resolves.toBe("NOT_FOUND");
      await expect(codeOf(library.items.row({ id: stranger }))).resolves.toBe("NOT_FOUND");
    });

    it("organizes: tags case by case, a folder by its id, a pin and a title, and answers every tag the item carries", async () => {
      const { library } = await personalLibrary();
      const reading = newId();
      await library.folders.write({
        ops: [{ id: reading, name: "Reading", op: "create", parentId: null, sort: "a0" }],
      });
      const id = await note(library, ["Plans for #later."], {
        tags: ["Spring", "trips"],
        title: "Plans",
      });

      const { items } = await library.items.organize({
        addTags: ["SPRING", "plans"],
        folder: { id: reading },
        ids: [id],
        pinned: true,
        removeTags: ["TRIPS"],
        title: "Trip",
      });

      expect(items).toMatchObject([
        { folderId: reading, id, pinned: true, tags: ["Spring", "later", "plans"], title: "Trip" },
      ]);
      await expect(library.items.get({ id })).resolves.toMatchObject({
        fields: { folderId: reading, tags: ["Spring", "plans"], title: "Trip" },
      });
    });

    it("refuses an organize naming an item or a folder it lacks, landing none of it", async () => {
      const { accountId, library } = await personalLibrary();
      const id = await note(library, ["Kept."], { title: "Kept" });
      const head = await headOf(accountId);

      await expect(
        codeOf(library.items.organize({ ids: [id, newId()], pinned: true })),
      ).resolves.toBe("NOT_FOUND");
      await expect(
        codeOf(library.items.organize({ folder: { id: newId() }, ids: [id] })),
      ).resolves.toBe("NOT_FOUND");
      await expect(library.items.get({ id })).resolves.toMatchObject({
        fields: { folderId: null, pinnedAt: null },
      });
      expect(await headOf(accountId)).toBe(head);
    });

    it("deletes and restores items, naming the ids it could not change, and moves none already there", async () => {
      const { library } = await personalLibrary();
      const id = await note(library, ["Soon gone."]);
      const nobody = newId();
      await expect(library.items.delete({ ids: [id, nobody] })).resolves.toStrictEqual({
        deleted: [id],
        missing: [nobody],
      });
      const gone = await library.items.row({ id });
      await expect(library.items.delete({ ids: [id] })).resolves.toStrictEqual({
        deleted: [id],
        missing: [],
      });
      await expect(library.items.row({ id })).resolves.toStrictEqual(gone);

      await expect(library.items.restore({ ids: [id, nobody] })).resolves.toStrictEqual({
        addressHeld: [],
        missing: [nobody],
        restored: [id],
      });
      await expect(library.items.row({ id })).resolves.toMatchObject({
        fields: { deletedAt: null },
      });
    });

    it("leaves in Deleted an item whose address another item holds now, and says which", async () => {
      const { accountId, library } = await personalLibrary();
      const url = "https://example.com/held";
      const link = (deletedAt: number | null) =>
        noteFixture({ deletedAt, kind: "link", title: "A page", url });
      const first = await seedItem(accountId, { fields: link(SAVED_AT) });
      await seedItem(accountId, { fields: link(null) });
      await expect(library.items.restore({ ids: [first.id] })).resolves.toStrictEqual({
        addressHeld: [first.id],
        missing: [],
        restored: [],
      });
      await expect(library.items.row({ id: first.id })).resolves.toMatchObject({
        fields: { deletedAt: SAVED_AT },
      });
    });

    it("empties Deleted for good, counts any other id missing, and never makes a purged id again", async () => {
      const { accountId, library } = await personalLibrary();
      const made = noteOf(["Gone."]);
      await library.items.create(made);
      const kept = await note(library, ["Kept."]);
      await library.items.delete({ ids: [made.id] });
      const stranger = newId();

      await expect(library.items.purge({ ids: [made.id, kept, stranger] })).resolves.toStrictEqual({
        missing: [kept, stranger],
        purged: [made.id],
      });
      await expect(codeOf(library.items.get({ id: made.id }))).resolves.toBe("NOT_FOUND");
      await expect(codeOf(library.items.row({ id: made.id }))).resolves.toBe("NOT_FOUND");
      expect(await itemCount(accountId)).toBe(1);
      for (const table of [itemBody, itemSearch, itemTag]) {
        await expect(
          db.select().from(table).where(eq(table.itemId, made.id)),
        ).resolves.toStrictEqual([]);
      }
      await expect(
        db
          .select({ id: purgedItem.id })
          .from(purgedItem)
          .where(eq(purgedItem.accountId, accountId)),
      ).resolves.toStrictEqual([{ id: made.id }]);
      await expect(codeOf(library.items.create(made))).resolves.toBe("CONFLICT");
    });

    it("answers a resend by its op id with what the first call answered, and an id made twice without one as a conflict", async () => {
      const { accountId, library } = await personalLibrary();
      const made = noteOf(["Once."]);
      const first = await library.items.create({ ...made, opId: OP_ID });
      await expect(library.items.create({ ...made, opId: OP_ID })).resolves.toStrictEqual(first);
      await expect(codeOf(library.items.create(made))).resolves.toBe("CONFLICT");
      expect(await itemCount(accountId)).toBe(1);
      expect(await headOf(accountId)).toBe(first.item.seq);
    });

    it("keeps thousands of blocks as a new item's body, in reading order", async () => {
      const { library } = await personalLibrary();
      const made = noteOf(Array.from({ length: 2000 }, (_, at) => `line ${String(at)}`));
      await library.items.create(made);
      const { blocks } = await library.items.get({ id: made.id });
      expect(blocks.map(({ block }) => block.id)).toStrictEqual(
        made.blocks.map(({ block }) => block.id),
      );
    });

    it("lands a pill showing what its source gives, whatever display the call sent", async () => {
      const { library } = await personalLibrary();
      const made = noteOf([]);
      const sum = pillParagraph(`${made.id}-sum`, "2+2", "5");
      const { item: landed } = await library.items.create({
        ...made,
        blocks: [{ block: sum, section: "note" }],
      });
      expect(landed.card.preview).toBe("4");
      const { blocks } = await library.items.get({ id: made.id });
      expect(blocks).toStrictEqual([{ block: pillParagraph(sum.id, "2+2", "4"), section: "note" }]);
    });

    it("refuses a body past what one holds as too large, landing none of it", async () => {
      const { accountId, library } = await personalLibrary();
      const line = "x".repeat(BLOCK_MAX_BYTES - 1024);
      const made = noteOf(Array.from({ length: 5 }, () => line));
      await expect(codeOf(library.items.create(made))).resolves.toBe("PAYLOAD_TOO_LARGE");
      expect(await itemCount(accountId)).toBe(0);
      expect(await headOf(accountId)).toBe(0);
    });
  });

  describe("folders", () => {
    it("writes folders guarded by name and parent, a deleted one taking its children", async () => {
      const { accountId, library } = await personalLibrary();
      const a = newId();
      const b = newId();
      const under = newId();
      const made = await library.folders.write({
        ops: [
          { id: a, name: "Recipes", op: "create", parentId: null, sort: "a0" },
          { id: b, name: "Travel", op: "create", parentId: null, sort: "a1" },
          { id: under, name: "Rome", op: "create", parentId: b, sort: "a0" },
        ],
      });
      expect(made.folders.map(({ name }) => name)).toStrictEqual(["Recipes", "Travel", "Rome"]);
      expect(made.seq).toBe(await headOf(accountId));
      // a sibling already holds the name
      await expect(
        refusalOf(
          library.folders.write({
            ops: [{ base: "Travel", id: b, name: "recipes", op: "rename" }],
          }),
        ),
      ).resolves.toMatchObject({ code: "CONFLICT", defined: true });
      await expect(
        refusalOf(
          library.folders.write({
            ops: [{ id: newId(), name: "Lost", op: "create", parentId: newId(), sort: "a0" }],
          }),
        ),
      ).resolves.toMatchObject({ code: "NOT_FOUND", defined: true });

      const deleted = await library.folders.write({ ops: [{ id: b, op: "delete" }] });
      expect(deleted.folders).toMatchObject([
        { deletedAt: expect.any(Number), id: b },
        { deletedAt: expect.any(Number), id: under },
      ]);
      await expect(liveFolders(accountId)).resolves.toMatchObject([{ name: "Recipes" }]);
      // a delete already true lands nothing, and moves no sequence
      await expect(
        library.folders.write({ ops: [{ id: b, op: "delete" }] }),
      ).resolves.toStrictEqual({ folders: [], seq: deleted.seq });
    });

    it("files items into a folder by its path, making what is missing, and by its id", async () => {
      const { accountId, library } = await personalLibrary();
      const one = await note(library, ["One."]);
      const two = await note(library, ["Two."]);
      const filed = await library.items.organize({
        addTags: ["work"],
        folder: { path: "Projects/Garden" },
        ids: [one, two],
        pinned: true,
      });
      const [garden, projects] = await liveFolders(accountId);
      expect(projects).toMatchObject({ name: "Projects", parentId: null });
      expect(garden).toMatchObject({ name: "Garden", parentId: projects?.id });
      expect(filed.items).toMatchObject([
        { folderId: garden?.id, id: one, pinned: true, tags: ["work"] },
        { folderId: garden?.id, id: two, pinned: true, tags: ["work"] },
      ]);

      // the same path again, in another case, finds the folders it made
      await library.items.organize({ folder: { path: "projects/GARDEN" }, ids: [one] });
      await expect(liveFolders(accountId)).resolves.toHaveLength(2);

      const moved = await library.items.organize({
        folder: { id: projects?.id ?? "" },
        ids: [one],
        removeTags: ["WORK"],
        title: "One, renamed",
      });
      expect(moved.items).toMatchObject([
        { folderId: projects?.id, pinned: true, tags: [], title: "One, renamed" },
      ]);
    });

    it("makes a note from markdown, filed by a path it makes and tagged, landing once under its op id", async () => {
      const { accountId, library } = await personalLibrary();
      const input = {
        folder: { path: "Journal" },
        markdown: "# Plan\n\nWater the **garden**.",
        opId: OP_ID,
        tags: ["home"],
        title: "Plan",
      };
      const { item: made } = await library.items.createNote(input);
      expect(made.fields).toMatchObject({ kind: "note", tags: ["home"], title: "Plan" });
      const [journal] = await liveFolders(accountId);
      expect(made.fields.folderId).toBe(journal?.id);
      const { blocks } = await library.items.get({ id: made.id });
      expect(blocks.map(({ section }) => section)).toStrictEqual(["note", "note"]);
      await expect(library.items.createNote(input)).resolves.toStrictEqual({ item: made });
      await expect(itemCount(accountId)).resolves.toBe(1);
    });

    it("takes a path's names trimmed, and refuses one no folder can hold", async () => {
      const { accountId, library } = await personalLibrary();
      const id = await note(library, ["Short."]);
      for (const path of [`Work/${"x".repeat(256)}`, " / "]) {
        await expect(codeOf(library.items.organize({ folder: { path }, ids: [id] }))).resolves.toBe(
          "BAD_REQUEST",
        );
      }
      const { items } = await library.items.organize({
        folder: { path: " Work / Reading " },
        ids: [id],
      });
      const folders = await liveFolders(accountId);
      expect(folders.map(({ name }) => name)).toStrictEqual(["Reading", "Work"]);
      expect(items[0]?.folderId).toBe(folders[0]?.id);
    });
  });

  describe("tags and properties", () => {
    it("respells a tag taken out and put back in one change", async () => {
      const { library } = await personalLibrary();
      const id = await note(library, ["One."]);
      await library.items.organize({ addTags: ["Foo", "bar"], ids: [id] });
      const respelled = await library.items.organize({
        addTags: ["foo"],
        ids: [id],
        removeTags: ["Foo"],
      });
      expect(respelled.items[0]?.tags).toStrictEqual(["bar", "foo"]);
      await expect(library.items.get({ id })).resolves.toMatchObject({
        fields: { tags: ["foo", "bar"] },
      });
    });

    it("lands each property only over the value it was read at, and lands nothing of a stale write", async () => {
      const { accountId, library } = await personalLibrary();
      const id = await note(library, ["A line."]);
      const draft = await library.write({
        itemId: id,
        ops: [{ key: "status", op: "property", value: "draft" }],
      });
      const done = await library.write({
        itemId: id,
        ops: [{ base: "draft", key: "status", op: "property", value: "done" }],
      });
      expect(done.item.seq).toBe(draft.item.seq + 1);

      // a second writer read the status before that edit, and the rating as it stands
      await expect(
        codeOf(
          library.write({
            itemId: id,
            ops: [
              { key: "rating", op: "property", value: 5 },
              { base: "draft", key: "status", op: "property", value: "a lost edit" },
            ],
          }),
        ),
      ).resolves.toBe("CONFLICT");
      expect(await headOf(accountId)).toBe(done.item.seq);
      await expect(propertiesOf(library, id)).resolves.toStrictEqual({ status: "done" });
      await expect(
        codeOf(library.write({ itemId: newId(), ops: [{ key: "a", op: "property", value: 1 }] })),
      ).resolves.toBe("NOT_FOUND");
    });

    it("merges two writers' edits to different properties with no conflict", async () => {
      const { library } = await personalLibrary();
      const id = await note(library, ["A line."]);
      for (const [key, value] of Object.entries({
        rating: "From the phone",
        status: "From the laptop",
      })) {
        await library.write({ itemId: id, ops: [{ key, op: "property", value }] });
      }
      await expect(propertiesOf(library, id)).resolves.toStrictEqual({
        rating: "From the phone",
        status: "From the laptop",
      });
    });

    it("refuses a property past the item's caps as too large, landing none of it", async () => {
      const { accountId, library } = await personalLibrary();
      const id = await note(library, ["A line."]);
      const { item: held } = await library.write({
        itemId: id,
        ops: [{ key: "notes", op: "property", value: "x".repeat(200 * 1024) }],
      });
      await expect(
        codeOf(
          library.write({
            itemId: id,
            ops: [{ key: "more", op: "property", value: "y".repeat(100 * 1024) }],
          }),
        ),
      ).resolves.toBe("PAYLOAD_TOO_LARGE");
      expect(await headOf(accountId)).toBe(held.seq);
    });
  });

  describe("files", () => {
    it("refuses a file whose bytes were never uploaded, and lands it once they are", async () => {
      const { accountId, library } = await personalLibrary();
      const input = {
        folderId: null,
        id: newId(),
        name: "photo.png",
        savedAt: SAVED_AT,
        sha: SHA,
        tags: [],
      };
      await expect(refusalOf(library.items.createFile(input))).resolves.toStrictEqual({
        code: "BLOB_MISSING",
        data: { shas: [SHA] },
        defined: true,
      });
      await seedFile(accountId, SHA, { mime: "image/png" });
      await expect(library.items.createFile(input)).resolves.toMatchObject({
        item: {
          fields: { kind: "image", originalName: "photo.png", originalSha: SHA },
          id: input.id,
        },
      });
      await expect(
        db
          .select({ itemId: itemFile.itemId })
          .from(itemFile)
          .where(eq(itemFile.accountId, accountId)),
      ).resolves.toStrictEqual([{ itemId: input.id }]);
    });

    it("refuses a body embedding a file the library does not hold", async () => {
      const { accountId, library } = await personalLibrary();
      const picture: BodyBlock = {
        block: { children: [{ text: "" }], id: "img1", sha: SHA, type: "img" },
        section: "note",
      };
      const made = { ...noteOf(["A picture."]), blocks: [picture] };
      await expect(refusalOf(library.items.create(made))).resolves.toStrictEqual({
        code: "BLOB_MISSING",
        data: { shas: [SHA] },
        defined: true,
      });
      await seedFile(accountId, SHA);
      await library.items.create(made);
      await expect(
        db
          .select({ itemId: itemFile.itemId })
          .from(itemFile)
          .where(eq(itemFile.accountId, accountId)),
      ).resolves.toStrictEqual([{ itemId: made.id }]);
    });

    it("touches the files an item named as it is purged, so they wait a day for another name", async () => {
      const { accountId, library } = await personalLibrary();
      await seedFile(accountId, SHA, { touchedAt: 1 });
      const id = newId();
      await library.items.createFile({
        folderId: null,
        id,
        name: "photo.png",
        savedAt: SAVED_AT,
        sha: SHA,
        tags: [],
      });
      await library.items.delete({ ids: [id] });
      const before = Date.now();
      await library.items.purge({ ids: [id] });
      await expect(
        db
          .select({ itemId: itemFile.itemId })
          .from(itemFile)
          .where(eq(itemFile.accountId, accountId)),
      ).resolves.toStrictEqual([]);
      const [held] = await db
        .select({ touchedAt: file.touchedAt })
        .from(file)
        .where(eq(file.accountId, accountId));
      expect(held?.touchedAt).toBeGreaterThanOrEqual(before);
    });
  });

  describe("who may write", () => {
    it("never reads or changes another account's items", async () => {
      const { accountId, library: mine } = await personalLibrary();
      const theirs = libraryAs(sessionPrincipal(await makeAccount()));
      const id = await note(mine, ["Mine alone."], { title: "Mine" });
      const row = await mine.items.row({ id });

      await expect(codeOf(theirs.items.get({ id }))).resolves.toBe("NOT_FOUND");
      await expect(codeOf(theirs.items.row({ id }))).resolves.toBe("NOT_FOUND");
      await expect(codeOf(theirs.items.organize({ ids: [id], pinned: true }))).resolves.toBe(
        "NOT_FOUND",
      );
      await expect(
        codeOf(theirs.write({ itemId: id, ops: [{ key: "a", op: "property", value: 1 }] })),
      ).resolves.toBe("NOT_FOUND");
      await expect(theirs.items.delete({ ids: [id] })).resolves.toStrictEqual({
        deleted: [],
        missing: [id],
      });
      await expect(theirs.items.purge({ ids: [id] })).resolves.toStrictEqual({
        missing: [id],
        purged: [],
      });
      await expect(mine.items.row({ id })).resolves.toStrictEqual(row);
      expect(await itemCount(accountId)).toBe(1);
    });

    it("refuses every write to a grant that only reads, and reads for it", async () => {
      const accountId = await makeAccount();
      const held = await seedItem(accountId, { fields: noteFixture({ title: "Held" }) });
      const grant = (scopes: ("library" | "library:read")[]) =>
        libraryAs({
          accountId,
          actor: {
            clientId: "https://client.example/metadata.json",
            clientName: "An assistant",
            grantId: randomUUID(),
            kind: "assistant",
            scopes,
          },
        });
      const reader = grant(["library:read"]);
      await expect(reader.items.row({ id: held.id })).resolves.toMatchObject({ id: held.id });
      await expect(refusalOf(reader.items.create(noteOf(["No."])))).resolves.toMatchObject({
        code: "FORBIDDEN",
        defined: false,
      });
      await expect(refusalOf(reader.items.delete({ ids: [held.id] }))).resolves.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(await itemCount(accountId)).toBe(1);

      await grant(["library", "library:read"]).items.delete({ ids: [held.id] });
      await expect(reader.items.row({ id: held.id })).resolves.toMatchObject({
        fields: { deletedAt: expect.any(Number) },
      });
    });
  });
});
