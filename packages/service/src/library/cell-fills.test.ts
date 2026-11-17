// The cloud's reading as the cell lands it: only the article and the facts a fill owns, over an
// item still waiting for it, at the address it was saved at, and folded into the change set of the
// agent's turn that saved it; and the reading's ask kept as a job row, which the alarm sends, and
// again until the queue took it.

import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import type { FillLanding } from "../fill/fill-landing";
import { pngOf } from "../fill/test-support/fill-cell";
import { paragraph } from "@repo/contract/test-support/library-items";
import {
  cellIn,
  cellOf,
  clockAt,
  headOf,
  inCell,
  newAccountId,
  openTurn,
} from "../test-support/library-cell";
import { uploadedFile } from "../test-support/library-files";
import type { TurnActor } from "./cell-actor";
import { runJobs, runKind } from "./cell-alarm";
import { readBlobRow } from "./cell-blobs";
import { landReading } from "./cell-fills";
import { heldBody } from "./cell-body";
import { cellDbOf } from "./cell-db";
import { readItem } from "./library-queries";

const undoTurn = async (library: ReturnType<typeof cellIn>["client"], turn: TurnActor) =>
  await library.agent.undo({ threadId: turn.threadId, turn: turn.turn });

const read = (
  landing: Pick<FillLanding, "itemId" | "url">,
  article: readonly LibraryBlock[],
  overrides: Partial<Extract<FillLanding, { kind: "read" }>> = {},
): FillLanding => ({
  article: [...article],
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
});

// a live item's fields and the body its cell keeps
const stateOf = (state: DurableObjectState, itemId: string) => {
  const db = cellDbOf(state.storage);
  const item = readItem(db, itemId);
  const body = heldBody(db, itemId);
  return item === null
    ? null
    : { blocks: body?.kind === "seed" ? body.blocks : [], fields: item.fields };
};

const sectionOf = (state: DurableObjectState, itemId: string, section: "note" | "article") =>
  (stateOf(state, itemId)?.blocks ?? [])
    .filter((held) => held.section === section)
    .map((held) => held.block);

const fillJobs = (state: DurableObjectState) =>
  state.storage.sql.exec("SELECT id, payload FROM jobs WHERE kind = 'fill' ORDER BY id").toArray();

describe("a page's reading, landed", () => {
  it("lands only the article and the facts a fill owns, and keeps no change set", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const { client: library, library: engine } = cellIn(state);
      const saved = await library.items.saveLink({
        note: "For Tuesday.",
        tags: ["reading"],
        url: "https://pages.example/a",
      });
      const { id } = saved.item;
      const note = sectionOf(state, id, "note");
      const landed = landReading(
        engine,
        read({ itemId: id, url: "https://pages.example/a" }, [paragraph("p1", "The article.")]),
        null,
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
      expect(state.storage.sql.exec("SELECT id FROM change_sets").toArray()).toStrictEqual([]);
    });
  });

  it("never touches the person's note or a title they gave while it waited", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const { client: library, library: engine } = cellIn(state);
      const saved = await library.items.saveLink({
        note: "First thought.",
        url: "https://pages.example/b",
      });
      const { id } = saved.item;
      await library.items.organize({ ids: [id], title: "My name for it" });
      landReading(
        engine,
        read({ itemId: id, url: "https://pages.example/b" }, [paragraph("p1", "The article.")]),
        null,
      );
      const after = stateOf(state, id);
      expect(JSON.stringify((after?.blocks ?? []).filter((b) => b.section === "note"))).toContain(
        "First thought.",
      );
      expect(after?.fields.title).toBe("My name for it");
    });
  });

  it("replaces a refreshed page's article", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const { client: library, library: engine } = cellIn(state);
      const url = "https://pages.example/c";
      const saved = await library.items.saveLink({ url });
      const { id } = saved.item;
      landReading(engine, read({ itemId: id, url }, [paragraph("old", "Alpha beta gamma.")]), null);
      await library.items.refresh({ id });
      landReading(
        engine,
        read({ itemId: id, url }, [paragraph("new", "Alpha beta gamma, read again.")]),
        null,
      );
      const article = (stateOf(state, id)?.blocks ?? []).filter((b) => b.section === "article");
      expect(article.map((stored) => stored.block.id)).toStrictEqual(["new"]);
    });
  });

  it("reads a page whose redirects end at another item's address into the item that waited", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const { client: library, library: engine } = cellIn(state);
      const final = "https://pages.example/final";
      const holder = await library.items.saveLink({ url: final });
      landReading(
        engine,
        read({ itemId: holder.item.id, url: final }, [paragraph("h", "Held.")]),
        null,
      );
      const short = "https://short.example/x";
      const stub = await library.items.saveLink({ tags: ["later"], url: short });
      const landed = landReading(
        engine,
        read({ itemId: stub.item.id, url: short }, [paragraph("r", "Read.")], { finalUrl: final }),
        null,
      );
      expect(landed).toMatchObject({ ok: true, value: { kind: "filled" } });
      expect(stateOf(state, stub.item.id)?.fields).toMatchObject({
        deletedAt: null,
        fetchState: "filled",
        tags: ["later"],
        title: "The page's own title",
        url: short,
      });
      expect(JSON.stringify(stateOf(state, stub.item.id)?.blocks ?? [])).toContain("Read.");
      expect(stateOf(state, holder.item.id)?.fields.tags).toStrictEqual([]);
      expect(JSON.stringify(stateOf(state, holder.item.id)?.blocks ?? [])).not.toContain("Read.");
    });
  });

  it("asks for the reading again when a link still waiting comes back from Deleted", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const cell = cellIn(state);
      const { client: library } = cell;
      const url = "https://pages.example/restored";
      const saved = await library.items.saveLink({ url });
      await runKind(cell, "fill");
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
      const cell = cellIn(state, { clock: clockAt(Date.now()) });
      const { client: library } = cell;
      const saved = await library.items.saveLink({ url: "https://pages.example/undone" });
      await runKind(cell, "fill");
      const turn = openTurn(cell);
      await turn.client.items.delete({ ids: [saved.item.id] });
      turn.end();
      await undoTurn(library, turn.actor);
      expect(stateOf(state, saved.item.id)?.fields.deletedAt).toBeNull();
      expect(fillJobs(state)).toStrictEqual([
        expect.objectContaining({ id: `fill:${saved.item.id}` }),
      ]);
    });
  });

  it("asks nothing for a link that stays in Deleted, or one already read", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const cell = cellIn(state);
      const { client: library, library: engine } = cell;
      const url = "https://pages.example/read";
      const saved = await library.items.saveLink({ url });
      landReading(engine, read({ itemId: saved.item.id, url }, [paragraph("p", "Read.")]), null);
      await runKind(cell, "fill");
      await library.items.delete({ ids: [saved.item.id] });
      await library.items.refresh({ id: saved.item.id });
      expect(fillJobs(state)).toStrictEqual([]);
      const other = await library.items.saveLink({ url: "https://pages.example/other-read" });
      landReading(
        engine,
        read({ itemId: other.item.id, url: "https://pages.example/other-read" }, [
          paragraph("q", "Read too."),
        ]),
        null,
      );
      await runKind(cell, "fill");
      await library.items.delete({ ids: [other.item.id] });
      await library.items.restore({ ids: [other.item.id] });
      expect(fillJobs(state)).toStrictEqual([]);
    });
  });

  it("lands nothing on an item that no longer waits for the reading", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const { client: library, library: engine } = cellIn(state);
      const url = "https://pages.example/d";
      const saved = await library.items.saveLink({ url });
      await library.items.delete({ ids: [saved.item.id] });
      const head = headOf(engine);
      expect(
        landReading(engine, read({ itemId: saved.item.id, url }, [paragraph("p", "x")]), null),
      ).toMatchObject({
        ok: true,
        value: { kind: "stale" },
      });
      // another address than the one the reading was asked at
      const moved = await library.items.saveLink({ url: "https://pages.example/e" });
      expect(
        landReading(
          engine,
          read({ itemId: moved.item.id, url: "https://pages.example/other" }, []),
          null,
        ),
      ).toMatchObject({ value: { kind: "stale" } });
      expect(headOf(engine)).toBe(head + 1);
    });
  });

  it("lets go at the alarm's next run the cover it kept, once it lands nowhere", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const cell = cellIn(state);
      const { client: library, library: engine } = cell;
      const db = cellDbOf(state.storage);
      const png = { mime: "image/png" };
      const named = await uploadedFile(engine, accountId, { ...png, bytes: pngOf(800, 600) });
      const stray = await uploadedFile(engine, accountId, { ...png, bytes: pngOf(900, 600) });
      const kept = await library.items.saveLink({ url: "https://pages.example/kept" });
      landReading(
        engine,
        read({ itemId: kept.item.id, url: "https://pages.example/kept" }, [], { coverSha: named }),
        null,
      );
      const gone = await library.items.saveLink({ url: "https://pages.example/gone" });
      await library.items.delete({ ids: [gone.item.id] });
      const asked = { itemId: gone.item.id, url: "https://pages.example/gone" };
      // two readings for an item deleted meanwhile: one kept a cover another item names
      for (const coverSha of [stray, named]) {
        expect(landReading(engine, read(asked, [], { coverSha }), null)).toMatchObject({
          value: { kind: "stale" },
        });
      }
      expect(readBlobRow(db, stray)).not.toBeNull();
      await runJobs(cell);
      expect(readBlobRow(db, stray)).toBeNull();
      expect(readBlobRow(db, named)).not.toBeNull();
    });
  });

  it("says a failure in the item, its text untouched", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const { client: library, library: engine } = cellIn(state);
      const url = "https://pages.example/f";
      const saved = await library.items.saveLink({ url });
      landReading(
        engine,
        {
          itemId: saved.item.id,
          kind: "failed",
          sentence: "The page took too long to answer.",
          url,
        },
        null,
      );
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
      async (state) => await cellIn(state).client.items.saveLink({ url }),
    );
    await expect(
      cellOf(accountId).landFill({
        itemId: saved.item.id,
        kind: "failed",
        sentence: "x".repeat(20_000),
        url,
      }),
    ).resolves.toStrictEqual({ ok: true, value: { kind: "stale" } });
    const fields = await inCell(
      cellOf(accountId),
      (state) => stateOf(state, saved.item.id)?.fields,
    );
    expect(fields?.fetchState).toBe("pending");
  });

  it("lands the article by the item's note while that note is still opening", async () => {
    const accountId = newAccountId();
    const cell = cellOf(accountId);
    const url = "https://pages.example/opening";
    const saved = await inCell(
      cell,
      async (state) => await cellIn(state).client.items.saveLink({ note: "For Tuesday.", url }),
    );
    // the note read its seed and went no further
    await expect(cell.readSeed(saved.item.id)).resolves.toMatchObject({ kind: "seed" });
    await expect(
      cell.landFill(read({ itemId: saved.item.id, url }, [paragraph("p1", "The article.")])),
    ).resolves.toStrictEqual({ ok: true, value: { kind: "filled" } });
    const item = await inCell(
      cell,
      async (state) => await cellIn(state).client.items.read({ id: saved.item.id }),
    );
    expect(item.fields.fetchState).toBe("filled");
    expect(item.view.markdown).toContain("For Tuesday.");
    expect(item.view.markdown).toContain("The article.");
  });
});

// a link the built-in agent saved in a turn that then ended, so the reading it held is let go
const savedByTurn = async (cell: ReturnType<typeof cellIn>, url: string) => {
  const turn = openTurn(cell);
  const { item } = await turn.client.items.saveLink({ url });
  turn.end();
  return { item, turn: turn.actor };
};

describe("Undo of a link the agent saved, once its page is read", () => {
  const HOUR = 3_600_000;

  it("takes a link the reading named to Deleted, the reading folded into the turn's set", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const cell = cellIn(state);
      const { client: library, library: engine } = cell;
      const url = "https://pages.example/named";
      const { item, turn } = await savedByTurn(cell, url);
      landReading(engine, read({ itemId: item.id, url }, [paragraph("p1", "The article.")]), null);
      expect(stateOf(state, item.id)?.fields.title).toBe("The page's own title");
      await expect(undoTurn(library, turn)).resolves.toMatchObject({
        kept: [],
        reverted: [item.id],
      });
      expect(stateOf(state, item.id)?.fields.deletedAt).not.toBeNull();
    });
  });

  it("takes a link to Deleted whose reading landed before its turn ended", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const cell = cellIn(state);
      const { client: library, library: engine } = cell;
      const url = "https://pages.example/early";
      const turn = openTurn(cell);
      const { item } = await turn.client.items.saveLink({ url });
      landReading(engine, read({ itemId: item.id, url }, [paragraph("p1", "The article.")]), null);
      turn.end();
      await expect(undoTurn(library, turn.actor)).resolves.toMatchObject({
        kept: [],
        reverted: [item.id],
      });
    });
  });

  it("takes a link that answered with a file to Deleted", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const cell = cellIn(state);
      const { client: library, library: engine } = cell;
      const url = "https://pages.example/figure.png";
      const originalSha = await uploadedFile(engine, accountId, {
        bytes: pngOf(800, 600),
        mime: "image/png",
      });
      const { item, turn } = await savedByTurn(cell, url);
      landReading(
        engine,
        {
          fileKind: "image",
          itemId: item.id,
          kind: "file",
          originalName: "figure.png",
          originalSha,
          url,
        },
        null,
      );
      expect(stateOf(state, item.id)?.fields.originalSha).toBe(originalSha);
      await expect(undoTurn(library, turn)).resolves.toMatchObject({
        kept: [],
        reverted: [item.id],
      });
      expect(stateOf(state, item.id)?.fields.deletedAt).not.toBeNull();
    });
  });

  it("keeps a link renamed once the reading named it", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const cell = cellIn(state);
      const { client: library, library: engine } = cell;
      const url = "https://pages.example/renamed";
      const { item, turn } = await savedByTurn(cell, url);
      landReading(engine, read({ itemId: item.id, url }, [paragraph("p1", "The article.")]), null);
      await library.items.organize({ ids: [item.id], title: "Mine" });
      await expect(undoTurn(library, turn)).resolves.toMatchObject({
        kept: [item.id],
        reverted: [],
      });
      expect(stateOf(state, item.id)?.fields).toMatchObject({ deletedAt: null, title: "Mine" });
    });
  });

  it("keeps a link renamed while it waited, the reading leaving that name", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const cell = cellIn(state);
      const { client: library, library: engine } = cell;
      const url = "https://pages.example/waited";
      const { item, turn } = await savedByTurn(cell, url);
      await library.items.organize({ ids: [item.id], title: "Mine" });
      landReading(engine, read({ itemId: item.id, url }, [paragraph("p1", "The article.")]), null);
      await expect(undoTurn(library, turn)).resolves.toMatchObject({
        kept: [item.id],
        reverted: [],
      });
    });
  });

  interface Carried {
    readonly folder?: { readonly path: string };
    readonly note?: string;
    readonly tags?: string[];
  }

  const CARRIED: readonly (readonly [string, Carried])[] = [
    ["a folder", { folder: { path: "Reading" } }],
    ["a note", { note: "For Tuesday." }],
    ["tags", { tags: ["later"] }],
  ];

  it.each(CARRIED)(
    "takes a link to Deleted though a later save of its address carried %s, which changed nothing",
    async (_, carried) => {
      const accountId = newAccountId();
      await inCell(cellOf(accountId), async (state) => {
        const clock = clockAt();
        const cell = cellIn(state, { clock });
        const { client: library, library: engine } = cell;
        const url = "https://pages.example/final";
        const { item: holder, turn } = await savedByTurn(cell, url);
        landReading(engine, read({ itemId: holder.id, url }, [paragraph("h", "Held.")]), null);
        clock.now += HOUR;
        const again = await library.items.saveLink({ ...carried, url });
        expect(again).toMatchObject({ created: false, item: { id: holder.id } });
        expect(stateOf(state, holder.id)?.fields).toMatchObject({ folderId: null, tags: [] });
        await expect(undoTurn(library, turn)).resolves.toMatchObject({
          kept: [],
          reverted: [holder.id],
        });
      });
    },
  );
});

describe("a reading's ask", () => {
  it("is a job row the write lands, which the alarm sends to the fill queue, again later while the send fails", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      const clock = clockAt();
      const cell = cellIn(state, { clock });
      const { client: library } = cell;
      const url = "https://pages.example/h";
      const saved = await library.items.saveLink({ url });
      expect(fillJobs(state)).toStrictEqual([
        { id: `fill:${saved.item.id}`, payload: expect.any(String) },
      ]);
      const queue = vi
        .spyOn(env.FILLS, "sendBatch")
        .mockRejectedValueOnce(new Error("the queue is down"));
      await runKind(cell, "fill");
      expect(fillJobs(state)).toHaveLength(1);
      // the failed send keeps its lease, so the alarm's next run does not send it again at once
      await runKind(cell, "fill");
      expect(queue).toHaveBeenCalledTimes(1);
      clock.now += 30_000;
      await runKind(cell, "fill");
      expect(queue).toHaveBeenLastCalledWith([
        { body: { accountId, coverHint: null, itemId: saved.item.id, url }, contentType: "json" },
      ]);
      queue.mockRestore();
      expect(fillJobs(state)).toStrictEqual([]);
      // a refresh asks again; a save of a held address asks nothing
      await library.items.refresh({ id: saved.item.id });
      await library.items.saveLink({ url });
      expect(fillJobs(state)).toHaveLength(1);
    });
  });

  it("stays for a send of its own when it is asked again while the queue takes the first", async () => {
    await inCell(cellOf(), async (state) => {
      const cell = cellIn(state);
      const { client: library } = cell;
      const saved = await library.items.saveLink({ url: "https://pages.example/i" });
      const queue = vi.spyOn(env.FILLS, "sendBatch").mockImplementationOnce(async (messages) => {
        await library.items.refresh({ id: saved.item.id });
        return await env.FILLS.sendBatch(messages);
      });
      await runKind(cell, "fill");
      // the first send's end left the row the refresh asked for, its runs counted from none
      expect(
        state.storage.sql.exec("SELECT attempts FROM jobs WHERE kind = 'fill'").toArray(),
      ).toStrictEqual([{ attempts: 0 }]);
      await runKind(cell, "fill");
      queue.mockRestore();
      expect(fillJobs(state)).toStrictEqual([]);
    });
  });
});
