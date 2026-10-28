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
import { libraryIn } from "../fill/test-support/fill-cell";
import {
  cellOf,
  clockAt,
  engineIn,
  inCell,
  newAccountId,
  paragraph,
} from "../test-support/library-cell";
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
      expect(sectionOf(state, id, "note")).toEqual(note);
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
      expect(sets).toEqual([{ label: "Read from the web", sealed_at: expect.any(Number) }]);
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
      expect(article.map((stored) => stored.block.id)).toEqual(["new"]);
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
      expect(held?.fields.tags).toEqual(["later"]);
      expect(JSON.stringify([...(held?.blocks.values() ?? [])])).toContain(
        "Saved from a short link.",
      );
      expect(JSON.stringify([...(held?.blocks.values() ?? [])])).toContain("Folded.");
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
    const saved = await inCell(cellOf(accountId), async (state) =>
      libraryIn(state, accountId).items.saveLink({ url }),
    );
    expect(
      await cellOf(accountId).landFill({
        itemId: saved.item.id,
        kind: "failed",
        sentence: "x".repeat(20_000),
        url,
      }),
    ).toEqual({ head: null, ok: true, value: { kind: "stale" } });
    const fields = await inCell(
      cellOf(accountId),
      (state) => stateOf(state, saved.item.id)?.fields,
    );
    expect(fields?.fetchState).toBe("pending");
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
      expect(fillJobs(state)).toEqual([
        { id: `fill:${saved.item.id}`, payload: expect.any(String) },
      ]);
      const claimed = engine.claimDueFills();
      expect(claimed.map((fill) => fill.request)).toEqual([
        { coverHint: null, itemId: saved.item.id, url: "https://pages.example/h" },
      ]);
      // claimed, so neither a second commit nor the alarm sends it again at once
      expect(engine.claimDueFills()).toEqual([]);
      clock.now += 60_000;
      const again = engine.claimDueFills();
      expect(again).toHaveLength(1);
      engine.fillsSent(again);
      expect(fillJobs(state)).toEqual([]);
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
      await state.storage.sql.exec("UPDATE jobs SET next_at = 0 WHERE kind = 'fill'");
      await sendFills(state, { ...env, FILLS: taking }, library);
      expect(fillJobs(state)).toEqual([]);
      expect(sent).toEqual([
        { accountId, coverHint: null, itemId: expect.any(String), url: "https://pages.example/i" },
      ]);
    });
  });
});
