// The cloud's reading as the cell lands it: only the article and the facts a fill owns, in a
// change set of its own, over an item still waiting for it; a page whose redirects end at another
// item's address folding onto that item; and the reading's ask kept as a job row, sent once the
// write commits and sent again until the queue took it.

import { ordsBetween } from "@repo/notes/library/block-order";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { FillJob } from "../fill/fill-job";
import type { FillLanding } from "../fill/fill-landing";
import { libraryIn, pngOf } from "../fill/test-support/fill-cell";
import {
  cellOf,
  clockAt,
  engineIn,
  inCell,
  newAccountId,
  paragraph,
} from "../test-support/library-cell";
import { uploadedFile } from "../test-support/library-files";
import { readBlobRow } from "./cell-blobs";
import { openCellLibrary, sendFills } from "./cell-library";
import { readItemState } from "@repo/notes/library/library-queries";
import { runPlan } from "@repo/notes/library/library-sql";
import { cellStorageOf } from "./cell-storage";

const read = (
  landing: Pick<FillLanding, "itemId" | "url">,
  article: readonly LibraryBlock[],
  overrides: Partial<Extract<FillLanding, { kind: "read" }>> = {},
): FillLanding => {
  const keys = ordsBetween(null, null, article.length);
  return {
    article: article.map((block, index) => ({ block, ord: keys[index] ?? "a0" })),
    coverSha: null,
    facts: {
      author: "A. Writer",
      description: "What the page says.",
      lang: "en",
      published: null,
      site: "Pages",
    },
    finalUrl: landing.url,
    itemId: landing.itemId,
    kind: "read",
    playable: null,
    title: "The page's own title",
    url: landing.url,
    ...overrides,
  };
};

const stateOf = (state: DurableObjectState, itemId: string) =>
  runPlan(cellStorageOf(state.storage), readItemState(itemId));

const sectionOf = (state: DurableObjectState, itemId: string, section: "note" | "article") =>
  [...(stateOf(state, itemId)?.blocks.values() ?? [])]
    .filter((stored) => stored.section === section)
    .map((stored) => ({ hash: stored.hash, id: stored.block.id }));

const fillJobs = (state: DurableObjectState) =>
  state.storage.sql.exec("SELECT id, payload FROM jobs WHERE kind = 'fill' ORDER BY id").toArray();

describe("a page's reading, landed", () => {
  it("lands only the article and the facts a fill owns, in a change set of its own", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const library = libraryIn(state, accountId);
      const saved = await library.items.saveLink({
        note: "For Tuesday.",
        tags: ["reading"],
        url: "https://pages.example/a",
      });
      const { id } = saved.item;
      const note = sectionOf(state, id, "note");
      const landed = openCellLibrary(state, env).landReading(
        read({ itemId: id, url: "https://pages.example/a" }, [paragraph("p1", "The article.")]),
      );
      expect(landed).toMatchObject({ ok: true, value: { kind: "filled" } });
      expect(sectionOf(state, id, "note")).toStrictEqual(note);
      expect(sectionOf(state, id, "article")).toHaveLength(1);
      expect(stateOf(state, id)?.fields).toMatchObject({
        author: "A. Writer",
        fetchError: null,
        fetchState: "filled",
        site: "Pages",
        tags: ["reading"],
        title: "The page's own title",
      });
      const sets = state.storage.sql
        .exec("SELECT label, sealed_at FROM change_sets WHERE actor = 'fill'")
        .toArray();
      expect(sets).toStrictEqual([{ label: "Read from the web", sealed_at: expect.any(Number) }]);
    });
  });

  it("places the passage a link was saved with once the reading holds its text", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const library = libraryIn(state, accountId);
      const url = "https://pages.example/selected";
      const saved = await library.items.saveLink({ selection: "the passage itself", url });
      openCellLibrary(state, env).landReading(
        read({ itemId: saved.item.id, url }, [
          paragraph("p1", "Before it, the passage itself, and after."),
        ]),
      );
      const { highlights } = await library.annotations.list({ itemId: saved.item.id });
      expect(highlights).toStrictEqual([
        expect.objectContaining({ placed: true, quote: "the passage itself" }),
      ]);
    });
  });

  it("never touches the person's note or a title they gave while it waited", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const library = libraryIn(state, accountId);
      const saved = await library.items.saveLink({
        note: "First thought.",
        url: "https://pages.example/b",
      });
      const { id } = saved.item;
      const [stored] = [...(stateOf(state, id)?.blocks.values() ?? [])];
      const engine = openCellLibrary(state, env);
      const edited = engine.write(
        { deviceId: "phone", kind: "person", label: "You on phone" },
        {
          itemId: id,
          ops: [
            {
              baseHash: stored?.hash ?? "",
              block: paragraph(stored?.block.id ?? "", "Second thought."),
              op: "put",
            },
            { base: saved.item.fields.title, field: "title", op: "set", value: "My name for it" },
          ],
        },
      );
      expect(edited.ok).toBe(true);
      engine.landReading(
        read({ itemId: id, url: "https://pages.example/b" }, [paragraph("p1", "The article.")]),
      );
      const after = stateOf(state, id);
      expect(
        JSON.stringify([...(after?.blocks.values() ?? [])].filter((b) => b.section === "note")),
      ).toContain("Second thought.");
      expect(after?.fields.title).toBe("My name for it");
    });
  });

  it("replaces a refreshed page's article and places its highlights again by their quotes", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const library = libraryIn(state, accountId);
      const url = "https://pages.example/c";
      const saved = await library.items.saveLink({ url });
      const { id } = saved.item;
      const engine = openCellLibrary(state, env);
      engine.landReading(read({ itemId: id, url }, [paragraph("old", "Alpha beta gamma.")]));
      const added = await library.annotations.add({ itemId: id, quote: "beta" });
      expect(added.highlight.placed).toBe(true);
      await library.items.refresh({ id });
      engine.landReading(
        read({ itemId: id, url }, [paragraph("new", "Alpha beta gamma, read again.")]),
      );
      const article = [...(stateOf(state, id)?.blocks.values() ?? [])].filter(
        (b) => b.section === "article",
      );
      expect(article.map((stored) => stored.block.id)).toStrictEqual(["new"]);
      expect(JSON.stringify(article)).toContain(added.highlight.id);
    });
  });

  it("folds a page whose redirects end at another item's address onto that item", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const library = libraryIn(state, accountId);
      const engine = openCellLibrary(state, env);
      const holder = await library.items.saveLink({ url: "https://pages.example/final" });
      engine.landReading(
        read({ itemId: holder.item.id, url: "https://pages.example/final" }, [
          paragraph("h", "Held."),
        ]),
      );
      const stub = await library.items.saveLink({
        note: "Saved from a short link.",
        tags: ["later"],
        url: "https://short.example/x",
      });
      const landed = engine.landReading(
        read(
          { itemId: stub.item.id, url: "https://short.example/x" },
          [paragraph("f", "Folded.")],
          {
            finalUrl: "https://pages.example/final",
          },
        ),
      );
      expect(landed).toMatchObject({ ok: true, value: { intoId: holder.item.id, kind: "folded" } });
      expect(stateOf(state, stub.item.id)?.fields.deletedAt).not.toBeNull();
      const held = stateOf(state, holder.item.id);
      expect(held?.fields.tags).toStrictEqual(["later"]);
      expect(JSON.stringify([...(held?.blocks.values() ?? [])])).toContain(
        "Saved from a short link.",
      );
      expect(JSON.stringify([...(held?.blocks.values() ?? [])])).toContain("Folded.");
    });
  });

  it("carries a stub's note onto the item its page folds onto, as that item's note", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const library = libraryIn(state, accountId);
      const engine = openCellLibrary(state, env);
      const holder = await library.items.saveLink({ url: "https://pages.example/final" });
      engine.landReading(
        read({ itemId: holder.item.id, url: "https://pages.example/final" }, [
          paragraph("h", "Held."),
        ]),
      );
      const stub = await library.items.saveLink({
        note: "Look at this",
        url: "https://short.example/x",
      });
      engine.landReading(
        read(
          { itemId: stub.item.id, url: "https://short.example/x" },
          [paragraph("f", "Folded.")],
          {
            finalUrl: "https://pages.example/final",
          },
        ),
      );
      const note = [...(stateOf(state, holder.item.id)?.blocks.values() ?? [])].filter(
        (stored) => stored.section === "note",
      );
      expect(note).toHaveLength(1);
      expect(JSON.stringify(note)).toContain("Look at this");
      expect(stateOf(state, holder.item.id)?.fields.title).toBe("The page's own title");
    });
  });

  it("leaves a folded link read, so it stays where a person restores it", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const engine = openCellLibrary(state, env);
      const library = libraryIn(state, accountId, engine);
      const holder = await library.items.saveLink({ url: "https://pages.example/final" });
      engine.landReading(
        read({ itemId: holder.item.id, url: "https://pages.example/final" }, [
          paragraph("h", "Held."),
        ]),
      );
      const stub = await library.items.saveLink({ url: "https://short.example/x" });
      await sendFills(state, env, engine);
      engine.landReading(
        read(
          { itemId: stub.item.id, url: "https://short.example/x" },
          [paragraph("f", "Folded.")],
          { finalUrl: "https://pages.example/final" },
        ),
      );
      await library.items.restore({ ids: [stub.item.id] });
      expect(stateOf(state, stub.item.id)?.fields).toMatchObject({
        deletedAt: null,
        fetchState: "filled",
      });
      expect(fillJobs(state)).toStrictEqual([]);
    });
  });

  it("folds by the reading's own rule: a fact only where the page gave one, a title only over the address", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const library = libraryIn(state, accountId);
      const engine = openCellLibrary(state, env);
      const final = "https://pages.example/kept-facts";
      const holder = await library.items.saveLink({ url: final });
      engine.landReading(read({ itemId: holder.item.id, url: final }, [paragraph("h", "Held.")]));
      const stub = await library.items.saveLink({ url: "https://short.example/facts" });
      engine.landReading(
        read({ itemId: stub.item.id, url: "https://short.example/facts" }, [paragraph("f", "F.")], {
          facts: { author: null, description: null, lang: "fr", published: null, site: null },
          finalUrl: final,
          title: "Another title",
        }),
      );
      expect(stateOf(state, holder.item.id)?.fields).toMatchObject({
        author: "A. Writer",
        description: "What the page says.",
        lang: "fr",
        site: "Pages",
        title: "The page's own title",
      });
    });
  });

  it("keeps the title a person gave an unread item a page folds onto", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const library = libraryIn(state, accountId);
      const engine = openCellLibrary(state, env);
      const final = "https://pages.example/named";
      const holder = await library.items.saveLink({ title: "My name for it", url: final });
      const stub = await library.items.saveLink({ url: "https://short.example/named" });
      engine.landReading(
        read({ itemId: stub.item.id, url: "https://short.example/named" }, [paragraph("f", "F.")], {
          finalUrl: final,
        }),
      );
      expect(stateOf(state, holder.item.id)?.fields).toMatchObject({
        author: "A. Writer",
        fetchState: "filled",
        title: "My name for it",
      });
    });
  });

  it("names an unread item still called by its address after the page folded onto it", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const library = libraryIn(state, accountId);
      const engine = openCellLibrary(state, env);
      const final = "https://pages.example/placeholder";
      const holder = await library.items.saveLink({ url: final });
      const stub = await library.items.saveLink({ url: "https://short.example/placeholder" });
      engine.landReading(
        read(
          { itemId: stub.item.id, url: "https://short.example/placeholder" },
          [paragraph("f", "F.")],
          { finalUrl: final },
        ),
      );
      expect(stateOf(state, holder.item.id)?.fields.title).toBe("The page's own title");
    });
  });

  it("asks for the reading again when a link still waiting comes back from Deleted", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const engine = openCellLibrary(state, env);
      const library = libraryIn(state, accountId, engine);
      const url = "https://pages.example/restored";
      const saved = await library.items.saveLink({ url });
      await sendFills(state, env, engine);
      await library.items.delete({ ids: [saved.item.id] });
      expect(fillJobs(state)).toStrictEqual([]);
      // the queue's message met a deleted item, so it was acked with nothing landed
      await library.items.restore({ ids: [saved.item.id] });
      expect(fillJobs(state)).toStrictEqual([
        expect.objectContaining({ id: `fill:${saved.item.id}` }),
      ]);
    });
  });

  it("asks for the reading again when an undo brings a link still waiting back", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const clock = clockAt(Date.now());
      const engine = engineIn(state, clock);
      const library = libraryIn(state, accountId, engine);
      const saved = await library.items.saveLink({ url: "https://pages.example/undone" });
      await sendFills(state, env, engine);
      clock.now += 120_000;
      await library.items.delete({ ids: [saved.item.id] });
      clock.now += 120_000;
      engine.runDueJobs(() => {});
      const { changeSets } = await library.history.list({ itemId: saved.item.id });
      const [deleted] = changeSets;
      await library.history.undo({ changeSetIds: [deleted?.id ?? ""] });
      expect(stateOf(state, saved.item.id)?.fields.deletedAt).toBeNull();
      expect(fillJobs(state)).toStrictEqual([
        expect.objectContaining({ id: `fill:${saved.item.id}` }),
      ]);
    });
  });

  it("asks nothing for a link that stays in Deleted, or one already read", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const engine = openCellLibrary(state, env);
      const library = libraryIn(state, accountId, engine);
      const url = "https://pages.example/read";
      const saved = await library.items.saveLink({ url });
      engine.landReading(read({ itemId: saved.item.id, url }, [paragraph("p", "Read.")]));
      await sendFills(state, env, engine);
      await library.items.delete({ ids: [saved.item.id] });
      await library.items.refresh({ id: saved.item.id });
      expect(fillJobs(state)).toStrictEqual([]);
      const other = await library.items.saveLink({ url: "https://pages.example/other-read" });
      engine.landReading(
        read({ itemId: other.item.id, url: "https://pages.example/other-read" }, [
          paragraph("q", "Read too."),
        ]),
      );
      await sendFills(state, env, engine);
      await library.items.delete({ ids: [other.item.id] });
      await library.items.restore({ ids: [other.item.id] });
      expect(fillJobs(state)).toStrictEqual([]);
    });
  });

  it("lands nothing on an item that no longer waits for the reading", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const library = libraryIn(state, accountId);
      const url = "https://pages.example/d";
      const saved = await library.items.saveLink({ url });
      await library.items.delete({ ids: [saved.item.id] });
      const engine = openCellLibrary(state, env);
      const head = engine.head();
      expect(
        engine.landReading(read({ itemId: saved.item.id, url }, [paragraph("p", "x")])),
      ).toMatchObject({
        ok: true,
        value: { kind: "stale" },
      });
      // another address than the one the reading was asked at
      const moved = await library.items.saveLink({ url: "https://pages.example/e" });
      expect(
        engine.landReading(read({ itemId: moved.item.id, url: "https://pages.example/other" }, [])),
      ).toMatchObject({ value: { kind: "stale" } });
      expect(engine.head()).toBe(head + 1);
    });
  });

  it("lets go at the alarm's next run the cover it kept, once it lands nowhere", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const library = libraryIn(state, accountId);
      const engine = openCellLibrary(state, env);
      const storage = cellStorageOf(state.storage);
      const png = { mime: "image/png" };
      const named = await uploadedFile(engine, accountId, { ...png, bytes: pngOf(800, 600) });
      const stray = await uploadedFile(engine, accountId, { ...png, bytes: pngOf(900, 600) });
      const refused = await uploadedFile(engine, accountId, { ...png, bytes: pngOf(1000, 600) });
      const kept = await library.items.saveLink({ url: "https://pages.example/kept" });
      engine.landReading(
        read({ itemId: kept.item.id, url: "https://pages.example/kept" }, [], { coverSha: named }),
      );
      const gone = await library.items.saveLink({ url: "https://pages.example/gone" });
      await library.items.delete({ ids: [gone.item.id] });
      const asked = { itemId: gone.item.id, url: "https://pages.example/gone" };
      // two readings for an item deleted meanwhile: one kept a cover another item names
      for (const coverSha of [stray, named]) {
        expect(engine.landReading(read(asked, [], { coverSha }))).toMatchObject({
          value: { kind: "stale" },
        });
      }
      // and one the library had no room for
      const waiting = await library.items.saveLink({ url: "https://pages.example/full" });
      const full = engineIn(state, clockAt(Date.now()), 1);
      expect(
        full.landReading(
          read(
            { itemId: waiting.item.id, url: "https://pages.example/full" },
            [paragraph("p", "x")],
            {
              coverSha: refused,
            },
          ),
        ),
      ).toMatchObject({ ok: false, refusal: { kind: "quota" } });
      expect(readBlobRow(storage, stray)).not.toBeNull();
      engine.runDueJobs(() => {
        throw new Error("no job fails here");
      });
      expect(readBlobRow(storage, stray)).toBeNull();
      expect(readBlobRow(storage, refused)).toBeNull();
      expect(readBlobRow(storage, named)).not.toBeNull();
    });
  });

  it("says a failure in the item, its text untouched", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const library = libraryIn(state, accountId);
      const url = "https://pages.example/f";
      const saved = await library.items.saveLink({ url });
      openCellLibrary(state, env).landReading({
        itemId: saved.item.id,
        kind: "failed",
        sentence: "The page took too long to answer.",
        url,
      });
      expect(stateOf(state, saved.item.id)?.fields).toMatchObject({
        fetchError: "The page took too long to answer.",
        fetchState: "failed",
        title: saved.item.fields.title,
      });
    });
  });

  it("lands nothing at its door of a reading of another shape", async () => {
    const accountId = newAccountId();
    const url = "https://pages.example/g";
    const saved = await inCell(
      cellOf(accountId),
      async (state) => await libraryIn(state, accountId).items.saveLink({ url }),
    );
    await expect(
      cellOf(accountId).landFill({
        itemId: saved.item.id,
        kind: "failed",
        sentence: "x".repeat(20_000),
        url,
      }),
    ).resolves.toStrictEqual({ head: null, ok: true, value: { kind: "stale" } });
    const fields = await inCell(
      cellOf(accountId),
      (state) => stateOf(state, saved.item.id)?.fields,
    );
    expect(fields?.fetchState).toBe("pending");
  });
});

const undoSave = async (library: ReturnType<typeof libraryIn>, itemId: string) => {
  const { changeSets } = await library.history.list({ itemId });
  const made = changeSets.find((set) => set.items.some((item) => item.created));
  if (made === undefined) {
    throw new Error("no change set made the item");
  }
  return await library.history.undo({ changeSetIds: [made.id] });
};

describe("Undo of a saved link, once its page is read", () => {
  const PHONE = { deviceId: "phone", kind: "person", label: "You on phone" } as const;

  it("takes a link the reading named to Deleted, a fill being no person", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const library = libraryIn(state, accountId);
      const url = "https://pages.example/named";
      const { item } = await library.items.saveLink({ url });
      openCellLibrary(state, env).landReading(
        read({ itemId: item.id, url }, [paragraph("p1", "The article.")]),
      );
      expect(stateOf(state, item.id)?.fields.title).toBe("The page's own title");
      await expect(undoSave(library, item.id)).resolves.toMatchObject({
        kept: [],
        reverted: [item.id],
      });
      expect(stateOf(state, item.id)?.fields.deletedAt).not.toBeNull();
    });
  });

  it("takes a link that answered with a file to Deleted", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const library = libraryIn(state, accountId);
      const engine = openCellLibrary(state, env);
      const url = "https://pages.example/figure.png";
      const originalSha = await uploadedFile(engine, accountId, {
        bytes: pngOf(800, 600),
        mime: "image/png",
      });
      const { item } = await library.items.saveLink({ url });
      engine.landReading({
        fileKind: "image",
        itemId: item.id,
        kind: "file",
        originalName: "figure.png",
        originalSha,
        url,
      });
      expect(stateOf(state, item.id)?.fields.originalSha).toBe(originalSha);
      await expect(undoSave(library, item.id)).resolves.toMatchObject({
        kept: [],
        reverted: [item.id],
      });
      expect(stateOf(state, item.id)?.fields.deletedAt).not.toBeNull();
    });
  });

  it("keeps a link renamed once the reading named it", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const library = libraryIn(state, accountId);
      const engine = openCellLibrary(state, env);
      const url = "https://pages.example/renamed";
      const { item } = await library.items.saveLink({ url });
      engine.landReading(read({ itemId: item.id, url }, [paragraph("p1", "The article.")]));
      const renamed = engine.write(PHONE, {
        itemId: item.id,
        ops: [{ base: "The page's own title", field: "title", op: "set", value: "Mine" }],
      });
      expect(renamed.ok).toBe(true);
      await expect(undoSave(library, item.id)).resolves.toMatchObject({
        kept: [item.id],
        reverted: [],
      });
      expect(stateOf(state, item.id)?.fields).toMatchObject({ deletedAt: null, title: "Mine" });
    });
  });

  it("keeps a link renamed while it waited, the reading leaving that name", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const library = libraryIn(state, accountId);
      const engine = openCellLibrary(state, env);
      const url = "https://pages.example/waited";
      const { item } = await library.items.saveLink({ url });
      const renamed = engine.write(PHONE, {
        itemId: item.id,
        ops: [{ base: item.fields.title, field: "title", op: "set", value: "Mine" }],
      });
      expect(renamed.ok).toBe(true);
      engine.landReading(read({ itemId: item.id, url }, [paragraph("p1", "The article.")]));
      await expect(undoSave(library, item.id)).resolves.toMatchObject({
        kept: [item.id],
        reverted: [],
      });
    });
  });

  it("keeps a link a fold carried a person's tags onto", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const library = libraryIn(state, accountId);
      const engine = openCellLibrary(state, env);
      const url = "https://pages.example/final";
      const holder = await library.items.saveLink({ url });
      engine.landReading(read({ itemId: holder.item.id, url }, [paragraph("h", "Held.")]));
      const short = "https://short.example/y";
      const stub = await library.items.saveLink({ tags: ["later"], url: short });
      engine.landReading(
        read({ itemId: stub.item.id, url: short }, [paragraph("f", "Folded.")], { finalUrl: url }),
      );
      expect(stateOf(state, holder.item.id)?.fields.tags).toStrictEqual(["later"]);
      await expect(undoSave(library, holder.item.id)).resolves.toMatchObject({
        kept: [holder.item.id],
        reverted: [],
      });
    });
  });
});

describe("a reading's ask", () => {
  it("is a job row the write lands, claimed a minute at a time until the queue takes it", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const clock = clockAt();
      const engine = engineIn(state, clock);
      const library = libraryIn(state, accountId, engine);
      const saved = await library.items.saveLink({ url: "https://pages.example/h" });
      expect(fillJobs(state)).toStrictEqual([
        { id: `fill:${saved.item.id}`, payload: expect.any(String) },
      ]);
      const claimed = engine.claimDueFills();
      expect(claimed.map((fill) => fill.request)).toStrictEqual([
        { coverHint: null, itemId: saved.item.id, url: "https://pages.example/h" },
      ]);
      // claimed, so neither a second commit nor the alarm sends it again at once
      expect(engine.claimDueFills()).toStrictEqual([]);
      clock.now += 60_000;
      const again = engine.claimDueFills();
      expect(again).toHaveLength(1);
      engine.fillsSent(again);
      expect(fillJobs(state)).toStrictEqual([]);
      // a refresh asks again; a folded save of a held address asks nothing
      await library.items.refresh({ id: saved.item.id });
      await library.items.saveLink({ url: "https://pages.example/h" });
      expect(fillJobs(state)).toHaveLength(1);
    });
  });

  it("is sent to the fill queue after the commit, and kept for the alarm when the send fails", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const library = openCellLibrary(state, env);
      await libraryIn(state, accountId, library).items.saveLink({ url: "https://pages.example/i" });
      const sent: FillJob[] = [];
      const refusing: Queue<FillJob> = {
        metrics: async () => await Promise.reject(new Error("the queue is down")),
        send: async () => await Promise.reject(new Error("the queue is down")),
        sendBatch: async () => await Promise.reject(new Error("the queue is down")),
      };
      await sendFills(state, { ...env, FILLS: refusing }, library);
      expect(fillJobs(state)).toHaveLength(1);
      const taking: Queue<FillJob> = {
        ...refusing,
        sendBatch: async (messages) => {
          for (const message of messages) {
            sent.push(message.body);
          }
          return await env.FILLS.sendBatch(messages);
        },
      };
      // the failed send's claim holds the row a minute; the alarm then sends it again
      state.storage.sql.exec("UPDATE jobs SET next_at = 0 WHERE kind = 'fill'");
      await sendFills(state, { ...env, FILLS: taking }, library);
      expect(fillJobs(state)).toStrictEqual([]);
      expect(sent).toStrictEqual([
        { accountId, coverHint: null, itemId: expect.any(String), url: "https://pages.example/i" },
      ]);
    });
  });
});
