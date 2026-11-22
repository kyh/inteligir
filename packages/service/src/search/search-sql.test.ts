import { randomUUID } from "node:crypto";

import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { noteFixture, paragraph } from "@repo/contract/test-support/library-items.test-utils";
import { db } from "@repo/db/drizzle-client";
import { itemSearch } from "@repo/db/library-schema";
import { dbSuite } from "@repo/db/test-database";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { landItem } from "../library/library-landing";
import { readItem } from "../library/library-rows";
import { writeLibrary } from "../library/library-store";
import {
  createFolder,
  makeAccount,
  personalLibrary,
  seedItem,
} from "../test-support/library.fixture";
import { planSearchQuery } from "./search-query";
import { bodyTsqueryOf, isPrintableAscii, likeLiteral, tsqueryOf } from "./search-sql";

const SAVED_AT = Date.UTC(2026, 9, 1);

const linesOf: (lines: readonly string[]) => BodyBlock[] = (lines: readonly string[]) =>
  lines.map((text, at) => ({ block: paragraph(`p${String(at)}`, text), section: "note" }));

const note = async (
  accountId: string,
  lines: readonly string[],
  fields: Partial<LibraryItemFields> = {},
) => {
  const { id } = await seedItem(accountId, {
    blocks: linesOf(lines),
    fields: noteFixture({ savedAt: SAVED_AT, title: "", ...fields }),
  });

  return id;
};

describe(tsqueryOf, () => {
  it("asks each term by its word or its stem's shadow, a prefix while it is typed", () => {
    const [all, any] = planSearchQuery("interviewing cand");
    expect(all === undefined ? null : tsqueryOf(all)).toBe(
      "('interviewing' | '~interview') & ('cand':* | '~cand')",
    );
    expect(any === undefined ? null : tsqueryOf(any)).toBe(
      "('interviewing' | '~interview') | ('cand':* | '~cand')",
    );
  });

  it("asks the body for any term at the body's weight", () => {
    const [all] = planSearchQuery("interviewing cand");
    expect(bodyTsqueryOf(all?.terms ?? [])).toBe(
      "('interviewing':D | '~interview':D) | ('cand':*D | '~cand':D)",
    );
  });
});

describe("a literal needle", () => {
  it("is printable ascii on one line", () => {
    expect(isPrintableAscii("deploy now")).toBe(true);
    expect(isPrintableAscii("acción")).toBe(false);
    expect(isPrintableAscii("a\tb")).toBe(false);
    expect(isPrintableAscii("a\nb")).toBe(false);
  });

  it("is matched as written, a LIKE wildcard in it no wildcard", () => {
    expect(likeLiteral("50%_off\\")).toBe("50\\%\\_off\\\\");
  });
});

dbSuite("a search in Postgres", () => {
  it("finds a word as it is typed, by its prefix, and a whole word by its stem", async () => {
    const { accountId, library } = await personalLibrary();
    const hiring = await note(accountId, ["Interviewing candidates this week."]);
    await note(accountId, ["Nothing to see."]);

    for (const typed of ["i", "int", "interv", "interviewing"]) {
      const found = await library.search({ query: typed });
      expect(found.hits.map(({ id }) => id)).toStrictEqual([hiring]);
    }

    const byStem = await library.search({ query: "interviewer candidate" });
    expect(byStem.hits.map(({ id }) => id)).toStrictEqual([hiring]);
    expect(byStem.hits[0]?.snippet).toBe("Interviewing candidates this week.");
    await expect(library.search({ query: "hire" })).resolves.toStrictEqual({
      cursor: null,
      hits: [],
    });
  });

  it("searches by words and by a literal passage words alone cannot match", async () => {
    const { accountId, library } = await personalLibrary();
    const fox = await note(accountId, ["The quick brown fox."]);
    const code = await note(accountId, ["Call parse_v2(x) to read it."]);
    await note(accountId, ["Nothing to see."]);

    const words = await library.search({ query: "brown fox" });
    expect(words.hits.map((hit) => hit.id)).toStrictEqual([fox]);
    const literal = await library.search({ query: "parse_v2(" });
    expect(literal.hits.map((hit) => hit.id)).toStrictEqual([code]);
    expect(literal.hits[0]?.snippet).toBe("Call parse_v2(x) to read it.");
    await expect(library.search({ kinds: ["link"], query: "fox" })).resolves.toStrictEqual({
      cursor: null,
      hits: [],
    });
  });

  it("matches a literal's wildcards as the characters they are", async () => {
    const { accountId, library } = await personalLibrary();
    const sale = await note(accountId, ["Take 50%_off today."]);
    await note(accountId, ["Take 50 or 5000 off."]);
    const found = await library.search({ query: "50%_o" });
    expect(found.hits.map(({ id }) => id)).toStrictEqual([sale]);
  });

  it("leaves a needle too short for trigrams to the words", async () => {
    const { accountId, library } = await personalLibrary();
    const word = await note(accountId, ["v2 ships."]);
    await note(accountId, ["parse_v2 inside a word."]);
    const found = await library.search({ query: "v2" });
    expect(found.hits.map(({ id }) => id)).toStrictEqual([word]);
  });

  it("asks for every word first, then for any when none holds them all", async () => {
    const { accountId, library } = await personalLibrary();
    const fox = await note(accountId, ["A brown fox."]);
    const elephant = await note(accountId, ["An elephant."], { savedAt: SAVED_AT + 1 });

    const either = await library.search({ query: "brown elephant" });
    expect(either.hits.map(({ id }) => id).toSorted()).toStrictEqual([elephant, fox].toSorted());

    const both = await note(accountId, ["A brown elephant."]);
    const all = await library.search({ query: "brown elephant" });
    expect(all.hits.map(({ id }) => id)).toStrictEqual([both]);
  });

  it("ranks a title's hit above a body's", async () => {
    const { accountId, library } = await personalLibrary();
    const body = await note(accountId, ["The roadmap is due."], { savedAt: SAVED_AT + 1 });
    const title = await note(accountId, ["Plans."], { title: "Roadmap" });
    const found = await library.search({ query: "roadmap" });
    expect(found.hits.map(({ id }) => id)).toStrictEqual([title, body]);
    expect(found.hits[0]?.snippet).toBe("Roadmap");
  });

  it("finds an item in Deleted only from Deleted, by its words alone", async () => {
    const { accountId, library } = await personalLibrary();
    const gone = await note(accountId, ["A fox long gone."], { deletedAt: SAVED_AT + 5 });
    const kept = await note(accountId, ["The fox naps in the sun."]);
    await note(accountId, ["The dog barks."]);

    const live = await library.listing.page({ limit: 10, scope: { kind: "all" }, words: "fox" });
    expect(live.items.map(({ id }) => id)).toStrictEqual([kept]);
    expect(live.items[0]?.snippet).toBe("The fox naps in the sun.");

    const deleted = await library.listing.page({
      limit: 10,
      scope: { kind: "deleted" },
      words: "fox",
    });

    expect(deleted.items.map(({ id }) => id)).toStrictEqual([gone]);
    expect(deleted.items[0]?.snippet).toBe("A fox long gone.");
    await expect(
      library.listing.page({ limit: 10, scope: { kind: "all" }, words: "aps" }),
    ).resolves.toMatchObject({ items: [{ id: kept, snippet: "The fox naps in the sun." }] });
    await expect(
      library.listing.page({ limit: 10, scope: { kind: "deleted" }, words: "ong" }),
    ).resolves.toMatchObject({ items: [], total: 0 });
  });

  it("cuts a passage from what an item's fields say when its body holds no match", async () => {
    const { accountId, library } = await personalLibrary();
    const tagged = await note(accountId, ["Nothing here."], { tags: ["gardening"] });
    const found = await library.search({ query: "garden" });
    expect(found.hits).toMatchObject([{ id: tagged, snippet: "gardening" }]);
  });

  it("reads the body of a hit only when its body's words hold a term", async () => {
    const { accountId, library } = await personalLibrary();

    const titled = await note(accountId, ["Nothing here."], {
      tags: ["gardening"],
      title: "Gardening",
    });

    const typed = await note(accountId, ["Weeding the gardens today."]);
    await db
      .update(itemSearch)
      .set({ text: "A gardening line the body's words never held." })
      .where(and(eq(itemSearch.accountId, accountId), eq(itemSearch.itemId, titled)));
    const found = await library.search({ query: "gard" });
    expect(new Map(found.hits.map((hit) => [hit.id, hit.snippet]))).toStrictEqual(
      new Map([
        [titled, "gardening"],
        [typed, "Weeding the gardens today."],
      ]),
    );
  });

  it("names at most its candidates for a literal passage more items hold", async () => {
    const { accountId, library } = await personalLibrary();

    for (let n = 0; n < 230; n += 1) {
      await note(accountId, [`Row ${String(n)}: abcxyzzydef.`], { title: `Row ${String(n)}` });
    }

    const named = new Set<string>();
    let cursor: number | undefined;

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

  it("keeps an item's search row through a pin, a move and Deleted and back, and writes it again for a new name, tag, alias or note", async () => {
    const { accountId, library } = await personalLibrary();
    const id = await note(accountId, ["Quarterly planning."], { title: "Roadmap" });

    const found = async (query: string) => {
      const { hits } = await library.search({ query });

      return hits.map((hit) => [hit.id, hit.snippet]);
    };

    const rowVersion = async () => {
      const [row] = await db
        .select({ version: sql<string>`xmin::text` })
        .from(itemSearch)
        .where(and(eq(itemSearch.accountId, accountId), eq(itemSearch.itemId, id)));

      return row?.version;
    };

    const written = await rowVersion();
    const parentId = await createFolder(library, "Shelf");
    await library.items.organize({ ids: [id], pinned: true });
    await library.items.organize({ ids: [id], parent: { id: parentId } });
    await library.items.delete({ ids: [id] });
    await expect(found("planning")).resolves.toStrictEqual([]);
    await library.items.restore({ ids: [id] });
    await expect(found("planning")).resolves.toStrictEqual([[id, "Quarterly planning."]]);
    await expect(rowVersion()).resolves.toBe(written);

    await library.items.organize({ ids: [id], title: "Strategy" });
    await expect(found("strategy")).resolves.toStrictEqual([[id, "Strategy"]]);
    await expect(found("roadmap")).resolves.toStrictEqual([]);
    await library.items.organize({ addTags: ["okr"], ids: [id] });
    await expect(found("okr")).resolves.toStrictEqual([[id, "okr"]]);
    await writeLibrary(
      { accountId, actor: { kind: "person" } },
      { answer: z.unknown(), opId: undefined },
      async (scope) => {
        const before = await readItem(scope.tx, accountId, id);

        if (before === null) {
          throw new Error("the item is gone");
        }

        const fields = { ...before.fields, aliases: ["Northstar"] };

        return await landItem(scope, { before, body: null, fields, itemId: id });
      },
    );
    await expect(found("northstar")).resolves.toStrictEqual([[id, "Strategy"]]);
    await library.items.edit({
      edits: [{ newText: "Annual budget.", oldText: "Quarterly planning." }],
      id,
    });
    await expect(found("budget")).resolves.toStrictEqual([[id, "Annual budget."]]);
    await expect(found("planning")).resolves.toStrictEqual([]);
    await expect(rowVersion()).resolves.not.toBe(written);
  });

  it("answers no other account's items", async () => {
    const { accountId, library } = await personalLibrary();
    const mine = await note(accountId, ["A shared word: quokka."]);
    const other = await makeAccount();
    await note(other, ["A shared word: quokka."]);
    await seedItem(other, { fields: noteFixture({ title: "quokka" }), id: randomUUID() });
    const found = await library.search({ query: "quokka" });
    expect(found.hits.map(({ id }) => id)).toStrictEqual([mine]);
    const literal = await library.search({ query: "word: quo" });
    expect(literal.hits.map(({ id }) => id)).toStrictEqual([mine]);
  });
});
