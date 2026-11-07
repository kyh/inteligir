// The library's procedures in process: the router over a real cell, called as oRPC's router client
// calls it, so every input and output meets the contract's own schemas and every refusal arrives
// as the error its row declares.

import { ordsBetween } from "@repo/notes/library/block-order";
import { BLOCK_MAX_BYTES } from "@repo/notes/library/library-nodes";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { createRouterClient } from "@orpc/server";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  agentCellIn,
  cellOf,
  clockAt,
  createItem,
  engineIn,
  inCell,
  landedValue,
  noteFields,
  paragraph,
} from "../test-support/library-cell";
import type { Clock } from "../test-support/library-cell";
import { uuidV7 } from "@repo/notes/library/uuid-v7";
import { FILL_ACTOR } from "./cell-fills";
import { addFileBytes } from "./cell-quota";
import { cellStorageOf } from "./cell-storage";
import { cellActorOf } from "./library-principal";
import type { NamedPrincipal } from "./library-principal";
import { libraryRouter } from "./library-router";
import { isOrpcError } from "@repo/contract/cloud/v1/errors";

const SHA = "a".repeat(64);
const GiB = 1024 * 1024 * 1024;

const laptop = (accountId: string): NamedPrincipal => ({
  accountId,
  actor: { deviceId: "laptop-1", deviceName: "Laptop", kind: "device" },
  scopes: ["library"],
});

const newId = (): string => uuidV7(Date.now(), crypto.getRandomValues(new Uint8Array(16)));

const clientIn = (state: DurableObjectState, clock: Clock, principal = laptop("account")) => {
  const library = engineIn(state, clock);
  return createRouterClient(libraryRouter, {
    context: {
      agent: agentCellIn(state, library, { clock }),
      library,
      actor: () => cellActorOf(principal),
      settle: async (result) => result,
    },
  });
};

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

const articleOf = (blocks: readonly LibraryBlock[]) => {
  const ords = ordsBetween(null, null, blocks.length);
  return blocks.map((block, index) => ({ block, ord: ords[index] ?? "a0" }));
};

const FACTS = { author: null, description: null, lang: null, published: null, site: null };

const pageSave = (
  url: string,
  overrides: { article?: LibraryBlock[]; selection?: string | null; tags?: string[] } = {},
) => ({
  article: articleOf(
    overrides.article ?? [paragraph("p1", "The quick brown fox jumps over the lazy dog.")],
  ),
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
      expect(whole.view).toStrictEqual({
        from: 0,
        markdown: "First line.\n\nSecond line.\n\nThird line.\n",
        to: 3,
        total: 3,
      });
      expect(whole.fields).toMatchObject({ kind: "note", tags: ["Reading"], title: "Three lines" });

      const page = await library.items.read({ count: 1, from: 1, id: item.id });
      expect(page.view).toMatchObject({ from: 1, markdown: "Second line.\n", to: 2, total: 3 });

      const detailed = await library.items.read({ id: item.id, responseFormat: "detailed" });
      expect(detailed.fields.aliases).toStrictEqual([]);
      await expect(refusalOf(library.items.read({ id: newId() }))).resolves.toMatchObject({
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
      expect(highlights).toStrictEqual([
        expect.objectContaining({ placed: true, quote: "quick brown fox", text: "" }),
      ]);

      // the same url saved again, from another page: the one item gains the new tag
      const again = await library.items.save(
        pageSave("https://example.com/fox#top", { tags: ["Animals", "dogs"] }),
      );
      expect(again).toMatchObject({ folded: true, item: { id: first.item.id } });
      const read = await library.items.read({ id: first.item.id });
      expect(read.fields.tags).toStrictEqual(["animals", "dogs"]);
      expect(read.fields.fetchState).toBe("filled");
      expect(read.view.markdown).toContain(":::article");
    });
  });

  it("places an item's highlights again in the article a second save brings, and keeps the article a read without one", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      const url = "https://example.com/fox";
      const first = await library.items.save(pageSave(url, { selection: "quick brown fox" }));
      const listed = await library.annotations.list({ itemId: first.item.id });
      const [highlight] = listed.highlights;
      const placedAgain = async (markdown: string) => {
        const { highlights } = await library.annotations.list({ itemId: first.item.id });
        expect(highlights).toStrictEqual([
          expect.objectContaining({ id: highlight?.id, placed: true, quote: "quick brown fox" }),
        ]);
        const read = await library.items.read({ id: first.item.id });
        expect(read.view.markdown).toContain(markdown);
        return read;
      };

      // the page read again, its text changed around the passage
      await library.items.save(
        pageSave(url, { article: [paragraph("p2", "Now: the quick brown fox naps.")] }),
      );
      await placedAgain(`the %%i:${highlight?.id ?? ""}:start%%quick brown fox%%i:`);

      // the same selection sent again keeps the one highlight, placed in the newest article
      await library.items.save(
        pageSave(url, {
          article: [paragraph("p3", "Later: a quick brown fox, again.")],
          selection: "quick brown fox",
        }),
      );
      await placedAgain("Later: a %%i:");

      // a read that found no article leaves the item's
      const empty = { ...pageSave(url), article: [] };
      await library.items.save(empty);
      const read = await placedAgain("Later: a %%i:");
      expect(read.fields.fetchState).toBe("filled");
    });
  });

  it("folds a device's read by the reading's own rule, keeping a fact it left out and a title the person gave", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      const url = "https://example.com/saved-later";
      const stub = await library.items.saveLink({ title: "My name for it", url });
      const facts = { author: null, description: null, lang: null, published: null, site: null };
      await library.items.save({
        ...pageSave(url),
        facts: { ...facts, author: "A. Writer" },
      });
      await library.items.save({
        ...pageSave(url),
        facts: { ...facts, site: "Pages" },
        title: "The page's own title",
      });
      const read = await library.items.read({ id: stub.item.id });
      expect(read.fields).toMatchObject({
        author: "A. Writer",
        fetchState: "filled",
        site: "Pages",
        title: "My name for it",
      });
    });
  });

  it("keeps a link's selection as a highlight: waiting on a stub, placed in an item that holds its text", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      const stub = await library.items.saveLink({
        selection: "a passage the page holds",
        url: "https://example.com/later/unread",
      });
      expect(stub.folded).toBe(false);
      const waiting = await library.annotations.list({ itemId: stub.item.id });
      expect(waiting.highlights).toStrictEqual([
        expect.objectContaining({ placed: false, quote: "a passage the page holds", text: "" }),
      ]);

      const url = "https://example.com/fox";
      const page = await library.items.save(pageSave(url));
      const folded = await library.items.saveLink({ selection: "brown fox jumps", url });
      expect(folded).toMatchObject({ folded: true, item: { id: page.item.id } });
      const { highlights } = await library.annotations.list({ itemId: page.item.id });
      expect(highlights).toStrictEqual([
        expect.objectContaining({ placed: true, quote: "brown fox jumps" }),
      ]);
      const read = await library.items.read({ id: page.item.id });
      expect(read.view.markdown).toContain(
        `quick %%i:${highlights[0]?.id ?? ""}:start%%brown fox jumps%%i:`,
      );

      // the same passage sent again keeps the one highlight
      await library.items.saveLink({ selection: "brown fox jumps", url });
      const again = await library.annotations.list({ itemId: page.item.id });
      expect(again.highlights).toHaveLength(1);
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

      // a page whose read failed, asked for again: it waits for the cloud, its failure forgotten
      const { item: failed } = landedValue(
        createItem(engineIn(state, clockAt()), FILL_ACTOR, {
          blocks: [],
          fields: noteFields({
            fetchError: "The site refused the read.",
            fetchState: "failed",
            kind: "link",
            title: "A refusing site",
            url: "https://example.com/refuses",
          }),
          id: newId(),
        }),
      );
      const retried = await library.items.refresh({ id: failed.id });
      expect(retried.item.fields).toMatchObject({ fetchError: null, fetchState: "pending" });
      const page = await library.items.save(pageSave("https://example.com/read-again"));
      expect(page.item.fields.fetchState).toBe("filled");
      const reread = await library.items.refresh({ id: page.item.id });
      expect(reread.item.fields).toMatchObject({ fetchError: null, fetchState: "pending" });
      const note = await library.items.createNote({ markdown: "No page here." });
      await expect(refusalOf(library.items.refresh({ id: note.item.id }))).resolves.toMatchObject({
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
      await expect(
        refusalOf(
          library.items.edit({
            baseSeq: seq,
            edits: [{ newText: "Uno.", oldText: "One." }],
            id: item.id,
          }),
        ),
      ).resolves.toStrictEqual({
        code: "CONFLICT",
        data: { current: [{ itemId: item.id, kind: "item", seq: edited.seq }] },
        defined: true,
      });

      await expect(
        refusalOf(
          library.items.edit({
            baseSeq: edited.seq,
            edits: [{ newText: "x", oldText: "Not in the item." }],
            id: item.id,
          }),
        ),
      ).resolves.toStrictEqual({
        code: "UNPROCESSABLE_CONTENT",
        data: { edit: 0, reason: "missing" },
        defined: true,
      });
      // past the parse's own reach: a stack overflow nearer the conversion's reach surfaces in this
      // suite's module runner as a TypeError, where the bundle the Worker ships throws RangeError
      await expect(
        refusalOf(
          library.items.edit({
            baseSeq: edited.seq,
            edits: [{ newText: `${"> ".repeat(12_000)}x`, oldText: "One." }],
            id: item.id,
          }),
        ),
      ).resolves.toMatchObject({
        code: "UNPROCESSABLE_CONTENT",
        data: { edit: 0, reason: "too-deep" },
      });
    });
  });

  it("refuses text no block can store, and keeps what stood there", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      const { item } = await library.items.createNote({ markdown: "One." });
      const fence = `\`\`\`inteligir-html\n${"x".repeat(BLOCK_MAX_BYTES)}\n\`\`\`\n`;
      const edit = async () =>
        await library.items.edit({
          baseSeq: item.seq,
          edits: [{ newText: fence, oldText: "One." }],
          id: item.id,
        });
      await expect(refusalOf(edit())).resolves.toMatchObject({
        code: "UNPROCESSABLE_CONTENT",
        data: { edit: 0, reason: "unstorable" },
      });
      await expect(edit()).rejects.toThrow("That edit holds a block the library can't keep.");
      await expect(library.items.read({ id: item.id })).resolves.toMatchObject({
        view: { markdown: "One.\n" },
      });
      await expect(
        refusalOf(library.items.createNote({ markdown: `Kept.\n\n${fence}` })),
      ).resolves.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
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
      await expect(
        refusalOf(
          library.items.edit({
            baseSeq: read.seq,
            edits: [{ newText: "Note. Page.", oldText: "Note.\n\n:::article\n\nPage." }],
            id: item.id,
          }),
        ),
      ).resolves.toMatchObject({
        code: "UNPROCESSABLE_CONTENT",
        data: { edit: 0, reason: "section" },
      });
    });
  });

  it("respells a tag taken out and put back in one change", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      const { item } = await library.items.createNote({ markdown: "One." });
      await library.items.organize({ addTags: ["Foo", "bar"], ids: [item.id] });
      const respelled = await library.items.organize({
        addTags: ["foo"],
        ids: [item.id],
        removeTags: ["Foo"],
      });
      expect(respelled.items[0]?.tags).toStrictEqual(["foo", "bar"]);
      const { tags } = await library.organize.outline();
      expect(tags.map(({ tag }) => tag).toSorted()).toStrictEqual(["bar", "foo"]);
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
      expect(outline.tags).toStrictEqual([{ items: 2, tag: "work" }]);

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
      await expect(
        refusalOf(library.items.organize({ folder: { id: newId() }, ids: [one.item.id] })),
      ).resolves.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  it("deletes, restores and purges items, naming the ids it could not change", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      const { item } = await library.items.createNote({ markdown: "Soon gone." });
      const nobody = newId();
      await expect(library.items.delete({ ids: [item.id, nobody] })).resolves.toStrictEqual({
        deleted: [item.id],
        missing: [nobody],
      });
      await expect(library.items.read({ id: item.id })).resolves.toMatchObject({
        fields: { deletedAt: expect.any(String) },
      });
      await expect(library.items.restore({ ids: [item.id, nobody] })).resolves.toStrictEqual({
        addressHeld: [],
        missing: [nobody],
        restored: [item.id],
      });
      await library.items.delete({ ids: [item.id] });
      await expect(library.items.purge({ ids: [item.id] })).resolves.toStrictEqual({
        missing: [],
        purged: [item.id],
      });
      await expect(refusalOf(library.items.read({ id: item.id }))).resolves.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  it("leaves in Deleted an item whose address another item holds now, and says which", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      const url = "https://example.com/held";
      const { item: first } = await library.items.saveLink({ url });
      await library.items.delete({ ids: [first.id] });
      await library.items.saveLink({ url });
      await expect(library.items.restore({ ids: [first.id] })).resolves.toStrictEqual({
        addressHeld: [first.id],
        missing: [],
        restored: [],
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
      expect(
        listed.highlights
          .map((highlight) => highlight.placed)
          .toSorted((a, b) => Number(a) - Number(b)),
      ).toStrictEqual([false, true]);
      await expect(library.items.read({ id: item.id })).resolves.toMatchObject({ highlights: 2 });
      await expect(
        refusalOf(library.annotations.add({ itemId: newId(), quote: "anything" })),
      ).resolves.toMatchObject({ code: "NOT_FOUND" });
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
      ).resolves.toMatchObject({ code: "NOT_FOUND" });
      await library.folders.write({ ops: [{ id: b, op: "delete" }] });
      await expect(library.organize.outline()).resolves.toMatchObject({
        folders: [{ name: "Recipes" }],
      });
    });
  });

  it("keeps the person's filing rules, an empty page among them", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      await expect(library.agent.rules()).resolves.toStrictEqual({ rules: null });
      await expect(
        library.agent.setRules({ rules: "File recipes under Cooking." }),
      ).resolves.toStrictEqual({
        rules: "File recipes under Cooking.",
      });
      await expect(library.agent.rules()).resolves.toStrictEqual({
        rules: "File recipes under Cooking.",
      });
      await library.agent.setRules({ rules: "" });
      await expect(library.agent.rules()).resolves.toStrictEqual({ rules: "" });
    });
  });

  it("lists the change sets under the device's name, reads a revision and undoes a set once", async () => {
    await inCell(cellOf(), async (state) => {
      const clock = clockAt();
      const library = clientIn(state, clock);
      const { item } = await library.items.createNote({ markdown: "Before." });
      const { changeSets } = await library.history.list({ itemId: item.id });
      expect(changeSets).toStrictEqual([
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
      expect(undone.reverted).toStrictEqual([item.id]);
      await expect(
        refusalOf(library.history.undo({ changeSetIds: [made.id] })),
      ).resolves.toStrictEqual({
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
      expect(revision.blocks.map((stored) => stored.block)).toStrictEqual([
        expect.objectContaining({ children: [{ text: "Before." }] }),
      ]);
      await expect(
        refusalOf(library.history.revision({ itemId: item.id, rev: rev + 100 })),
      ).resolves.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  it("searches by words and by a literal passage words alone cannot match", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      const fox = await library.items.createNote({ markdown: "The quick brown fox." });
      const code = await library.items.createNote({ markdown: "Call parse_v2(x) to read it." });
      await library.items.createNote({ markdown: "Nothing to see." });

      const words = await library.search({ query: "brown fox" });
      expect(words.hits.map((hit) => hit.id)).toStrictEqual([fox.item.id]);
      const literal = await library.search({ query: "parse_v2(" });
      expect(literal.hits.map((hit) => hit.id)).toStrictEqual([code.item.id]);
      expect(literal.hits[0]?.snippet).toContain("parse_v2(");
      await expect(library.search({ kinds: ["link"], query: "fox" })).resolves.toStrictEqual({
        cursor: null,
        hits: [],
      });
    });
  });

  it("names at most its candidates for a literal passage more items hold", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      const [ord = "a0"] = ordsBetween(null, null, 1);
      for (let n = 0; n < 230; n += 1) {
        await library.items.create({
          blocks: [
            { block: paragraph("p1", `Row ${String(n)}: abcxyzzydef.`), ord, section: "note" },
          ],
          folderId: null,
          id: newId(),
          savedAt: Date.UTC(2026, 9, 1),
          tags: [],
          title: `Row ${String(n)}`,
        });
      }
      const named = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await library.search({ cursor, limit: 50, query: "xyzzy" });
        for (const hit of page.hits) {
          expect(hit.snippet).toContain("abcxyzzydef");
          named.add(hit.id);
        }
        cursor = page.cursor ?? undefined;
      } while (cursor !== undefined);
      expect(named.size).toBe(200);
    });
  });

  it("answers a folder name too long, a link under a held id and an edit past the library's room as their rows declare", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      await expect(
        refusalOf(
          library.items.createNote({ folder: { path: `Work/${"x".repeat(256)}` }, markdown: "x" }),
        ),
      ).resolves.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        refusalOf(library.items.createNote({ folder: { path: " / " }, markdown: "x" })),
      ).resolves.toMatchObject({ code: "BAD_REQUEST" });
      const { item } = await library.items.createNote({
        folder: { path: " Work / Reading " },
        markdown: "Short.",
      });
      const { folders } = await library.organize.outline();
      expect(folders.map((folder) => folder.name).toSorted()).toStrictEqual(["Reading", "Work"]);
      expect(folders.find((folder) => folder.name === "Reading")?.id).toBe(item.fields.folderId);

      const { seq } = await library.items.read({ id: item.id });
      await expect(
        refusalOf(library.items.saveLink({ id: item.id, url: "https://example.com/else" })),
      ).resolves.toStrictEqual({
        code: "CONFLICT",
        data: { current: [{ itemId: item.id, kind: "item", seq }] },
        defined: true,
      });

      addFileBytes(cellStorageOf(state.storage), GiB);
      await expect(
        refusalOf(
          library.items.edit({
            baseSeq: seq,
            edits: [{ newText: `Long. ${"word ".repeat(2000)}`, oldText: "Short." }],
            id: item.id,
          }),
        ),
      ).resolves.toMatchObject({ code: "QUOTA", defined: true });
      await expect(
        refusalOf(library.items.organize({ addTags: ["reading"], ids: [item.id] })),
      ).resolves.toMatchObject({ code: "QUOTA", defined: true });
    });
  });

  it("answers an undo the library has no room for as its row declares", async () => {
    await inCell(cellOf(), async (state) => {
      const clock = clockAt();
      const library = clientIn(state, clock);
      const passage = "A passage long enough to cut.";
      const { item } = await library.items.createNote({ markdown: passage });
      clock.now += 120_000;
      const { seq } = await library.items.read({ id: item.id });
      await library.items.edit({
        baseSeq: seq,
        edits: [{ newText: "Cut.", oldText: passage }],
        id: item.id,
      });
      const { changeSets } = await library.history.list({ itemId: item.id });
      addFileBytes(cellStorageOf(state.storage), GiB);
      await expect(
        refusalOf(library.history.undo({ changeSetIds: [changeSets[0]?.id ?? ""] })),
      ).resolves.toMatchObject({ code: "QUOTA", defined: true });
    });
  });

  it("answers an undo another item's link holds back in words that say so", async () => {
    await inCell(cellOf(), async (state) => {
      const clock = clockAt();
      const library = clientIn(state, clock);
      const url = "https://pages.example/held";
      const { item } = await library.items.saveLink({ url });
      clock.now += 120_000;
      await library.items.delete({ ids: [item.id] });
      clock.now += 120_000;
      const { changeSets } = await library.history.list({ itemId: item.id });
      const holder = await library.items.saveLink({ url });
      await expect(
        library.history.undo({ changeSetIds: [changeSets[0]?.id ?? ""] }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        data: { current: [{ itemId: holder.item.id, kind: "item" }] },
        defined: true,
        message: "Another item in your library already holds this link.",
      });
    });
  });

  it("lists the account's threads newest first, pages a thread's events, and deletes a thread as gone", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      const older = newId();
      const newer = newId();
      const { sql } = state.storage;
      // what a turn the cell ran leaves behind: a thread row and the events it stored
      const seedThread = (id: string, updatedAt: number, count: number) => {
        sql.exec(
          `INSERT INTO threads (id, title, status, created_at, updated_at, seq)
           VALUES (?, ?, 'idle', ?, ?, 0)`,
          id,
          `Thread at ${String(updatedAt)}`,
          updatedAt,
          updatedAt,
        );
        for (let idx = 0; idx < count; idx += 1) {
          sql.exec(
            `INSERT INTO thread_events (event_id, thread_id, idx, type, json, at, seq)
             VALUES (?, ?, ?, 'agent.message', ?, ?, 0)`,
            `${id}:1:${String(idx)}`,
            id,
            idx,
            JSON.stringify({ text: `Said ${String(idx)}.`, type: "agent.message" }),
            updatedAt,
          );
        }
      };
      seedThread(older, 1000, 3);
      seedThread(newer, 2000, 1);
      const olderEvents = [0, 1, 2].map((idx) => `${older}:1:${String(idx)}`);

      const first = await library.agent.list({ limit: 1 });
      expect(first.threads.map((thread) => thread.id)).toStrictEqual([newer]);
      const rest = await library.agent.list({ cursor: first.cursor ?? "", limit: 1 });
      expect(rest).toMatchObject({ cursor: null, threads: [{ id: older, status: "idle" }] });

      const opening = await library.agent.events({ limit: 2, threadId: older });
      expect(opening.events.map((event) => event.eventId)).toStrictEqual(olderEvents.slice(0, 2));
      expect(opening.more).toBe(true);
      const closing = await library.agent.events({ after: 1, limit: 2, threadId: older });
      expect(closing).toMatchObject({ events: [{ eventId: olderEvents[2], idx: 2 }], more: false });

      const before = await library.sync.pull({ cursor: 0, epoch: null });
      if (before.kind !== "changes") {
        throw new Error("a fresh pull started over");
      }
      await expect(library.agent.delete({ threadId: older })).resolves.toStrictEqual({
        deleted: true,
      });
      expect(sql.exec("SELECT id FROM threads").toArray()).toStrictEqual([{ id: newer }]);
      expect(
        sql.exec("SELECT event_id FROM thread_events WHERE thread_id = ?", older).toArray(),
      ).toStrictEqual([]);
      const after = await library.sync.pull({ cursor: before.upto, epoch: before.epoch });
      expect(after.kind === "changes" ? after.changes : []).toStrictEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: older, kind: "thread", row: null }),
          ...olderEvents.map((id) =>
            expect.objectContaining({ id, kind: "thread_event", row: null }),
          ),
        ]),
      );
      await expect(refusalOf(library.agent.events({ threadId: older }))).resolves.toMatchObject({
        code: "NOT_FOUND",
        defined: true,
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
      await expect(
        refusalOf(library.items.list({ cursor: "not-a-cursor" })),
      ).resolves.toMatchObject({
        code: "BAD_REQUEST",
      });
      const tagged = await library.items.list({ tag: "n" });
      expect(tagged.items).toHaveLength(3);
    });
  });

  it("refuses a file whose bytes were never uploaded", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      await expect(
        refusalOf(
          library.items.createFile({
            folderId: null,
            id: newId(),
            name: "photo.png",
            savedAt: Date.UTC(2026, 9, 1),
            sha: SHA,
            tags: [],
          }),
        ),
      ).resolves.toStrictEqual({ code: "BLOB_MISSING", data: { shas: [SHA] }, defined: true });
    });
  });

  it("answers a resend by its op id with what the first call answered", async () => {
    await inCell(cellOf(), async (state) => {
      const library = clientIn(state, clockAt());
      const opId = crypto.randomUUID();
      const first = await library.items.createNote({ markdown: "Once.", opId });
      const again = await library.items.createNote({ markdown: "Once.", opId });
      expect(again).toStrictEqual(first);
      const listed = await library.items.list({});
      expect(listed.items).toHaveLength(1);
    });
  });

  it("refuses a send to an agent this deployment has no Claude for, charging nothing, and reads the account's threads", async () => {
    await inCell(cellOf(), async (state) => {
      const clock = clockAt();
      const library = engineIn(state, clock);
      // a deployment with neither the scripted API nor a gateway
      const unconfigured: Env = { ...env, AGENT_GATEWAY_URL: "", ANTHROPIC_FAKE_URL: undefined };
      const { agent } = createRouterClient(libraryRouter, {
        context: {
          actor: () => cellActorOf(laptop("account")),
          agent: agentCellIn(state, library, { clock, env: unconfigured }),
          library,
          settle: async (result) => result,
        },
      });
      const threadId = crypto.randomUUID();
      await expect(refusalOf(agent.send({ text: "Tidy my library." }))).resolves.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        defined: true,
      });
      for (const call of [
        async () => await agent.respond({ eventId: `${threadId}:1:0`, result: "allow", threadId }),
        async () => await agent.cancel({ threadId }),
        async () => await agent.events({ threadId }),
        async () => await agent.delete({ threadId }),
      ]) {
        await expect(refusalOf(call())).resolves.toMatchObject({
          code: "NOT_FOUND",
          defined: true,
        });
      }
      // on by default, with nothing to make, and the day's allowance untouched
      await expect(agent.status()).resolves.toMatchObject({ enabled: true, turnsLeft: 2 });
      await expect(agent.list({})).resolves.toStrictEqual({ cursor: null, threads: [] });
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
      expect(bodies[0]?.blocks.map((stored) => stored.block)).toStrictEqual([
        expect.objectContaining({ children: [{ text: "Synced." }] }),
      ]);
    });
  });
});
