// The library's procedures in process: the router over a real cell, called as oRPC's router client
// calls it, so every input and output meets the contract's own schemas and every refusal arrives
// as the error its row declares.

import { ordsBetween } from "@repo/notes/library/block-order";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { createRouterClient, ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { cellOf, clockAt, engineIn, inCell, paragraph } from "../test-support/library-cell";
import type { Clock } from "../test-support/library-cell";
import { uuidV7 } from "./cell-ids";
import type { Principal } from "./library-principal";
import { libraryRouter } from "./library-router";

const SHA = "a".repeat(64);

const laptop = (accountId: string): Principal => ({
  accountId,
  actor: { deviceId: "laptop-1", deviceName: "Laptop", kind: "device" },
  scopes: ["library"],
});

const newId = (): string => uuidV7(Date.now(), crypto.getRandomValues(new Uint8Array(16)));

const clientIn = (state: DurableObjectState, clock: Clock, principal = laptop("account")) =>
  createRouterClient(libraryRouter, {
    context: { library: engineIn(state, clock), principal, settle: async (result) => result },
  });

// the refusal a call met, as its client reads it
const refusalOf = async (call: Promise<unknown>) => {
  try {
    await call;
  } catch (error) {
    if (error instanceof ORPCError) {
      return { code: error.code, data: error.data, defined: error.defined };
    }
    throw error;
  }
  throw new Error("the call landed what the test expected it to refuse");
};

const articleOf = (blocks: readonly LibraryBlock[]) => {
  const ords = ordsBetween(null, null, blocks.length);
  return blocks.map((block, index) => ({ block, ord: ords[index] ?? "a0" }));
};

const FACTS = { author: null, description: null, lang: null, published: null, site: null };

const pageSave = (url: string, overrides: { selection?: string | null; tags?: string[] } = {}) => ({
  article: articleOf([paragraph("p1", "The quick brown fox jumps over the lazy dog.")]),
  copySha: null,
  coverSha: null,
  facts: { ...FACTS, site: "example.com" },
  folderId: null,
  id: newId(),
  savedAt: Date.UTC(2026, 9, 1),
  selection: overrides.selection ?? null,
  tags: overrides.tags ?? [],
  title: "A page",
  url,
});

describe("the library's procedures", () => {
  it("makes a note from markdown and reads it back a page of blocks at a time", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      const { item } = await library.items.createNote({
        markdown: "First line.\n\nSecond line.\n\nThird line.",
        tags: ["Reading"],
        title: "Three lines",
      });
      expect(item.card.title).toBe("Three lines");

      const whole = await library.items.read({ id: item.id });
      expect(whole.view).toEqual({
        from: 0,
        markdown: "First line.\n\nSecond line.\n\nThird line.\n",
        to: 3,
        total: 3,
      });
      expect(whole.fields).toMatchObject({ kind: "note", tags: ["Reading"], title: "Three lines" });

      const page = await library.items.read({ count: 1, from: 1, id: item.id });
      expect(page.view).toMatchObject({ from: 1, markdown: "Second line.\n", to: 2, total: 3 });

      const detailed = await library.items.read({ id: item.id, responseFormat: "detailed" });
      expect(detailed.fields.aliases).toEqual([]);
      expect(await refusalOf(library.items.read({ id: newId() }))).toMatchObject({
        code: "NOT_FOUND",
        defined: true,
      });
    });
  });

  it("saves a page with its article, keeps a selection as a highlight, and folds a second save of the url", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      const first = await library.items.save(
        pageSave("https://example.com/fox", { selection: "quick brown fox", tags: ["animals"] }),
      );
      expect(first.folded).toBe(false);
      const { highlights } = await library.annotations.list({ itemId: first.item.id });
      expect(highlights).toEqual([
        expect.objectContaining({ placed: true, quote: "quick brown fox", text: "" }),
      ]);

      // the same url saved again, from another page: the one item gains the new tag
      const again = await library.items.save(
        pageSave("https://example.com/fox#top", { tags: ["Animals", "dogs"] }),
      );
      expect(again).toMatchObject({ folded: true, item: { id: first.item.id } });
      const read = await library.items.read({ id: first.item.id });
      expect(read.fields.tags).toEqual(["animals", "dogs"]);
      expect(read.fields.fetchState).toBe("filled");
      expect(read.view.markdown).toContain(":::article");
    });
  });

  it("lands a link to read later as a pending stub, and a refresh sends it back to pending", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      const saved = await library.items.saveLink({ url: "https://example.com/later/a-long-read" });
      expect(saved.folded).toBe(false);
      const read = await library.items.read({ id: saved.item.id });
      expect(read.fields).toMatchObject({ fetchState: "pending", kind: "link" });
      expect(read.fields.title).not.toBe("");

      const folded = await library.items.saveLink({
        note: "Read this one first.",
        url: "https://example.com/later/a-long-read",
      });
      expect(folded).toMatchObject({ folded: true, item: { id: saved.item.id } });
      await expect(library.items.read({ id: saved.item.id })).resolves.toMatchObject({
        view: { markdown: expect.stringContaining("Read this one first.") },
      });

      const refreshed = await library.items.refresh({ id: saved.item.id });
      expect(refreshed.item.id).toBe(saved.item.id);
      const note = await library.items.createNote({ markdown: "No page here." });
      expect(await refusalOf(library.items.refresh({ id: note.item.id }))).toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  it("edits an item's markdown against the sequence it was read at", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      const { item } = await library.items.createNote({ markdown: "One.\n\nTwo." });
      const { seq } = await library.items.read({ id: item.id });
      const edited = await library.items.edit({
        baseSeq: seq,
        edits: [{ newText: "Two, edited.", oldText: "Two." }],
        id: item.id,
      });
      expect(edited.seq).toBeGreaterThan(seq);
      await expect(library.items.read({ id: item.id })).resolves.toMatchObject({
        view: { markdown: "One.\n\nTwo, edited.\n" },
      });

      // a second edit read before the first: the item as it is now
      expect(
        await refusalOf(
          library.items.edit({
            baseSeq: seq,
            edits: [{ newText: "Uno.", oldText: "One." }],
            id: item.id,
          }),
        ),
      ).toEqual({
        code: "CONFLICT",
        data: { current: [{ itemId: item.id, kind: "item", seq: edited.seq }] },
        defined: true,
      });

      expect(
        await refusalOf(
          library.items.edit({
            baseSeq: edited.seq,
            edits: [{ newText: "x", oldText: "Not in the item." }],
            id: item.id,
          }),
        ),
      ).toEqual({
        code: "UNPROCESSABLE_CONTENT",
        data: { edit: 0, reason: "missing" },
        defined: true,
      });
      // past the parse's own reach: a stack overflow nearer the conversion's reach surfaces in this
      // suite's module runner as a TypeError, where the bundle the Worker ships throws RangeError
      expect(
        await refusalOf(
          library.items.edit({
            baseSeq: edited.seq,
            edits: [{ newText: `${"> ".repeat(12_000)}x`, oldText: "One." }],
            id: item.id,
          }),
        ),
      ).toMatchObject({ code: "UNPROCESSABLE_CONTENT", data: { edit: 0, reason: "too-deep" } });
    });
  });

  it("refuses an edit to the lines the article opens and closes on", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      const [noteOrd, pageOrd] = ordsBetween(null, null, 2);
      const { item } = await library.items.create({
        blocks: [
          { block: paragraph("n1", "Note."), ord: noteOrd ?? "a0", section: "note" },
          { block: paragraph("p1", "Page."), ord: pageOrd ?? "a1", section: "article" },
        ],
        folderId: null,
        id: newId(),
        savedAt: Date.UTC(2026, 9, 1),
        tags: [],
        title: "Both sections",
      });
      const read = await library.items.read({ id: item.id });
      expect(read.view.markdown).toBe("Note.\n\n:::article\n\nPage.\n\n:::\n");
      expect(
        await refusalOf(
          library.items.edit({
            baseSeq: read.seq,
            edits: [{ newText: "Note. Page.", oldText: "Note.\n\n:::article\n\nPage." }],
            id: item.id,
          }),
        ),
      ).toMatchObject({ code: "UNPROCESSABLE_CONTENT", data: { edit: 0, reason: "section" } });
    });
  });

  it("files items into a folder by its path, making what is missing, and by its id", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      const one = await library.items.createNote({ markdown: "One." });
      const two = await library.items.createNote({ markdown: "Two." });
      const filed = await library.items.organize({
        addTags: ["work"],
        folder: { path: "Projects/Garden" },
        ids: [one.item.id, two.item.id],
        pinned: true,
      });
      expect(filed.items).toHaveLength(2);
      const outline = await library.organize.outline();
      const projects = outline.folders.find((folder) => folder.name === "Projects");
      const garden = outline.folders.find((folder) => folder.name === "Garden");
      expect(garden).toMatchObject({ items: 2, parentId: projects?.id });
      expect(outline.tags).toEqual([{ items: 2, tag: "work" }]);

      // the same path again finds the folders it made
      await library.items.organize({ folder: { path: "Projects/Garden" }, ids: [one.item.id] });
      await expect(library.organize.outline()).resolves.toMatchObject({
        folders: [expect.any(Object), expect.any(Object)],
      });

      const moved = await library.items.organize({
        folder: { id: projects?.id ?? "" },
        ids: [one.item.id],
        removeTags: ["WORK"],
        title: "One, renamed",
      });
      expect(moved.items[0]).toMatchObject({
        folderId: projects?.id,
        pinned: true,
        tags: [],
        title: "One, renamed",
      });
      expect(
        await refusalOf(library.items.organize({ folder: { id: newId() }, ids: [one.item.id] })),
      ).toMatchObject({ code: "NOT_FOUND" });
    });
  });

  it("deletes, restores and purges items, naming the ids it could not change", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      const { item } = await library.items.createNote({ markdown: "Soon gone." });
      const nobody = newId();
      expect(await library.items.delete({ ids: [item.id, nobody] })).toEqual({
        deleted: [item.id],
        missing: [nobody],
      });
      await expect(library.items.read({ id: item.id })).resolves.toMatchObject({
        fields: { deletedAt: expect.any(String) },
      });
      expect(await library.items.restore({ ids: [item.id] })).toEqual({
        missing: [],
        restored: [item.id],
      });
      await library.items.delete({ ids: [item.id] });
      expect(await library.items.purge({ ids: [item.id] })).toEqual({
        missing: [],
        purged: [item.id],
      });
      expect(await refusalOf(library.items.read({ id: item.id }))).toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  it("adds a highlight by its passage, placed where the text holds it and kept unplaced where it does not", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      const { item } = await library.items.createNote({
        markdown: "A sentence worth keeping.",
        title: "Quotes",
      });
      const placed = await library.annotations.add({
        itemId: item.id,
        note: "Why it matters.",
        quote: "worth keeping",
      });
      expect(placed.highlight).toMatchObject({
        itemTitle: "Quotes",
        placed: true,
        quote: "worth keeping",
        text: "Why it matters.",
      });
      const unplaced = await library.annotations.add({ itemId: item.id, quote: "nowhere here" });
      expect(unplaced.highlight.placed).toBe(false);
      const listed = await library.annotations.list({ itemId: item.id });
      expect(listed.highlights.map((highlight) => highlight.placed).toSorted()).toEqual([
        false,
        true,
      ]);
      await expect(library.items.read({ id: item.id })).resolves.toMatchObject({ highlights: 2 });
      expect(
        await refusalOf(library.annotations.add({ itemId: newId(), quote: "anything" })),
      ).toMatchObject({ code: "NOT_FOUND" });
    });
  });

  it("writes folders guarded by name and parent", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      const [first, second] = ordsBetween(null, null, 2);
      const a = newId();
      const b = newId();
      await library.folders.write({
        ops: [
          { id: a, name: "Recipes", op: "create", parentId: null, sort: first ?? "a0" },
          { id: b, name: "Travel", op: "create", parentId: null, sort: second ?? "a1" },
        ],
      });
      // a sibling already holds the name
      expect(
        await refusalOf(
          library.folders.write({
            ops: [{ base: "Travel", id: b, name: "recipes", op: "rename" }],
          }),
        ),
      ).toMatchObject({ code: "CONFLICT", defined: true });
      expect(
        await refusalOf(
          library.folders.write({
            ops: [{ id: newId(), name: "Lost", op: "create", parentId: newId(), sort: "a0" }],
          }),
        ),
      ).toMatchObject({ code: "NOT_FOUND" });
      await library.folders.write({ ops: [{ id: b, op: "delete" }] });
      await expect(library.organize.outline()).resolves.toMatchObject({
        folders: [{ name: "Recipes" }],
      });
    });
  });

  it("lists the change sets under the device's name, reads a revision and undoes a set once", async () => {
    await inCell(cellOf(), async (state) => {
      const clock = clockAt();
      const library = clientIn(state, clock);
      const { item } = await library.items.createNote({ markdown: "Before." });
      const { changeSets } = await library.history.list({ itemId: item.id });
      expect(changeSets).toEqual([
        expect.objectContaining({
          actor: "person",
          itemCount: 1,
          items: [expect.objectContaining({ created: true, id: item.id })],
          label: "You on Laptop",
        }),
      ]);
      const [made] = changeSets;
      if (made === undefined) {
        throw new Error("no change set");
      }
      const undone = await library.history.undo({ changeSetIds: [made.id] });
      expect(undone.reverted).toEqual([item.id]);
      expect(await refusalOf(library.history.undo({ changeSetIds: [made.id] }))).toEqual({
        code: "ALREADY_UNDONE",
        data: { changeSetId: made.id, undoneBy: undone.changeSetId },
        defined: true,
      });
      const listed = await library.history.list({ itemId: item.id });
      const rev = listed.changeSets.find((set) => set.id === made.id)?.items[0]?.rev;
      if (rev === null || rev === undefined) {
        throw new Error("the sealed set names no revision");
      }
      const revision = await library.history.revision({ itemId: item.id, rev });
      expect(revision.blocks.map((stored) => stored.block)).toEqual([
        expect.objectContaining({ children: [{ text: "Before." }] }),
      ]);
      expect(
        await refusalOf(library.history.revision({ itemId: item.id, rev: rev + 100 })),
      ).toMatchObject({ code: "NOT_FOUND" });
    });
  });

  it("searches by words and by a literal passage words alone cannot match", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      const fox = await library.items.createNote({ markdown: "The quick brown fox." });
      const code = await library.items.createNote({ markdown: "Call parse_v2(x) to read it." });
      await library.items.createNote({ markdown: "Nothing to see." });

      const words = await library.search({ query: "brown fox" });
      expect(words.hits.map((hit) => hit.id)).toEqual([fox.item.id]);
      const literal = await library.search({ query: "parse_v2(" });
      expect(literal.hits.map((hit) => hit.id)).toEqual([code.item.id]);
      expect(literal.hits[0]?.snippet).toContain("parse_v2(");
      await expect(library.search({ kinds: ["link"], query: "fox" })).resolves.toEqual({
        cursor: null,
        hits: [],
      });
    });
  });

  it("lists items a page at a time and refuses a cursor it never answered with", async () => {
    await inCell(cellOf(), async (state) => {
      const clock = clockAt();
      const library = clientIn(state, clock);
      for (const n of [1, 2, 3]) {
        clock.now += 1000;
        await library.items.createNote({ markdown: `Item ${String(n)}.`, tags: ["n"] });
      }
      const first = await library.items.list({ limit: 2 });
      expect(first.items).toHaveLength(2);
      expect(first.cursor).not.toBeNull();
      const rest = await library.items.list({ cursor: first.cursor ?? "", limit: 2 });
      expect(rest).toMatchObject({ cursor: null, items: [expect.any(Object)] });
      expect(await refusalOf(library.items.list({ cursor: "not-a-cursor" }))).toMatchObject({
        code: "BAD_REQUEST",
      });
      const tagged = await library.items.list({ tag: "n" });
      expect(tagged.items).toHaveLength(3);
    });
  });

  it("refuses a file whose bytes were never uploaded", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      expect(
        await refusalOf(
          library.items.createFile({
            folderId: null,
            id: newId(),
            name: "photo.png",
            savedAt: Date.UTC(2026, 9, 1),
            sha: SHA,
            tags: [],
          }),
        ),
      ).toEqual({ code: "BLOB_MISSING", data: { shas: [SHA] }, defined: true });
    });
  });

  it("answers a resend by its op id with what the first call answered", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      const opId = crypto.randomUUID();
      const first = await library.items.createNote({ markdown: "Once.", opId });
      const again = await library.items.createNote({ markdown: "Once.", opId });
      expect(again).toEqual(first);
      const listed = await library.items.list({});
      expect(listed.items).toHaveLength(1);
    });
  });

  it("refuses every ask of the agent, and reads the account's threads", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      const threadId = crypto.randomUUID();
      for (const call of [
        () => library.agent.send({ text: "Tidy my library." }),
        () => library.agent.respond({ eventId: "sevt_1", result: "allow", threadId }),
        () => library.agent.cancel({ threadId }),
        () => library.agent.setEnabled({ enabled: true }),
      ]) {
        expect(await refusalOf(call())).toMatchObject({
          code: "SERVICE_UNAVAILABLE",
          defined: true,
        });
      }
      expect(await library.agent.status()).toMatchObject({ enabled: false, turnsLeft: 0 });
      expect(await library.agent.list({})).toEqual({ cursor: null, threads: [] });
      expect(await refusalOf(library.agent.events({ threadId }))).toMatchObject({
        code: "NOT_FOUND",
      });
      expect(await refusalOf(library.agent.delete({ threadId }))).toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  it("pulls what landed and the bodies it names", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      const { item } = await library.items.createNote({ markdown: "Synced." });
      const pulled = await library.sync.pull({ cursor: 0, epoch: null });
      if (pulled.kind !== "changes") {
        throw new Error("a fresh replica was told to reset");
      }
      expect(pulled.changes.map((change) => change.kind)).toContain("item");
      const { bodies } = await library.sync.bodies({ ids: [item.id] });
      expect(bodies[0]?.blocks.map((stored) => stored.block)).toEqual([
        expect.objectContaining({ children: [{ text: "Synced." }] }),
      ]);
    });
  });
});
