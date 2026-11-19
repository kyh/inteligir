import { deriveItem } from "@repo/contract/library/derive-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import type { DbExecutor } from "@repo/db/drizzle-client";
import { item, itemBody, itemSearch } from "@repo/db/library-schema";
import { findTextOffsets } from "@repo/editor/headless/knowledge/text-matches";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { passageIn, termMatch } from "./search-excerpt";
import { planSearchQuery } from "./search-query";
import type { SearchQueryPlan, SearchQueryTerm } from "./search-query";
import { BODY_WEIGHT, lexemeLiteral } from "./search-vector";

export type SearchSide = "live" | "deleted";

const SEARCH_CANDIDATES = 200;
const LITERAL_PAGE = 50;

const LITERAL_MIN_CHARS = 3;

const PASSAGE_SCAN_CHARS = 64 * 1024;

const LITERAL_PASSAGE_REACH = 2048;

const termQuery = (term: SearchQueryTerm, weight = "") => {
  const label = (prefix: boolean) =>
    prefix || weight !== "" ? `:${prefix ? "*" : ""}${weight}` : "";

  return `(${lexemeLiteral(term.token)}${label(term.prefix)} | ${lexemeLiteral(`~${term.stem}`)}${label(false)})`;
};

export const tsqueryOf = (plan: SearchQueryPlan) =>
  plan.terms.map((term) => termQuery(term)).join(plan.match === "all" ? " & " : " | ");

export const bodyTsqueryOf = (terms: readonly SearchQueryTerm[]) =>
  terms.map((term) => termQuery(term, BODY_WEIGHT)).join(" | ");

const PRINTABLE_ASCII = /^[ -~]+$/u;

export const isPrintableAscii = (needle: string) => PRINTABLE_ASCII.test(needle);

export const likeLiteral = (text: string) => text.replaceAll(/[\\%_]/gu, "\\$&");

const holding = (needle: string) =>
  sql`lower(${itemSearch.text}) like ${`%${likeLiteral(needle.toLowerCase())}%`} escape '\\'`;

const itemOfSearchRow = and(
  eq(item.accountId, itemSearch.accountId),
  eq(item.id, itemSearch.itemId),
);

const idOrder = sql`${itemSearch.itemId} collate "C"`;

interface Ranked {
  readonly ids: readonly string[];
  readonly terms: readonly SearchQueryTerm[];
}

const rankedHits = async (db: DbExecutor, accountId: string, query: string, side: SearchSide) => {
  for (const plan of planSearchQuery(query)) {
    const tsquery = sql`${tsqueryOf(plan)}::tsquery`;

    const rows = await db
      .select({ id: itemSearch.itemId })
      .from(itemSearch)
      .innerJoin(item, itemOfSearchRow)
      .where(
        and(
          eq(itemSearch.accountId, accountId),
          sql`${itemSearch.vec} @@ ${tsquery}`,
          side === "deleted" ? isNotNull(item.deletedAt) : isNull(item.deletedAt),
        ),
      )
      .orderBy(desc(sql`ts_rank(${itemSearch.vec}, ${tsquery}, 1)`), idOrder)
      .limit(SEARCH_CANDIDATES);

    if (rows.length > 0) {
      return { ids: rows.map((row) => row.id), terms: plan.terms } satisfies Ranked;
    }
  }

  return { ids: [], terms: [] } satisfies Ranked;
};

const literalMatches = async (
  db: DbExecutor,
  accountId: string,
  needle: string,
  after: string | null,
) => {
  const rows = await db
    .select({ id: itemSearch.itemId })
    .from(itemSearch)
    .innerJoin(item, itemOfSearchRow)
    .where(
      and(
        eq(itemSearch.accountId, accountId),
        isNull(item.deletedAt),
        holding(needle),
        after === null ? undefined : sql`${idOrder} > ${after}`,
      ),
    )
    .orderBy(idOrder)
    .limit(LITERAL_PAGE);

  return rows.map((row) => row.id);
};

interface ShownHit {
  readonly id: string;
  readonly fields: LibraryItemFields;
}

export interface SearchHits {
  readonly rank: ReadonlyMap<string, number>;
  readonly passages: (shown: readonly ShownHit[]) => Promise<ReadonlyMap<string, string>>;
}

const literalPassages = async (
  db: DbExecutor,
  accountId: string,
  ids: readonly string[],
  needle: string,
) => {
  const folded = needle.toLowerCase();
  const start = sql`greatest(strpos(lower(${itemSearch.text}), ${folded}) - ${LITERAL_PASSAGE_REACH}, 1)`;

  const rows = await db
    .select({
      id: itemSearch.itemId,
      text: sql<string>`substr(${itemSearch.text}, ${start}, ${2 * LITERAL_PASSAGE_REACH + folded.length})`,
    })
    .from(itemSearch)
    .where(and(eq(itemSearch.accountId, accountId), inArray(itemSearch.itemId, [...ids])));

  const passages = new Map<string, string>();

  for (const row of rows) {
    const passage = passageIn(row.text, (line) =>
      line.toLowerCase().includes(folded)
        ? findTextOffsets(line, needle, { caseSensitive: false, wholeWord: false })[0]
        : undefined,
    );

    if (passage !== null) {
      passages.set(row.id, passage);
    }
  }

  return passages;
};

const rankedPassages = async (
  db: DbExecutor,
  accountId: string,
  shown: readonly ShownHit[],
  terms: readonly SearchQueryTerm[],
) => {
  const inBody = sql`${itemSearch.vec} @@ ${bodyTsqueryOf(terms)}::tsquery`;

  const rows = await db
    .select({
      digest: itemBody.digest,
      id: itemSearch.itemId,
      text: sql<
        string | null
      >`case when ${inBody} then left(${itemSearch.text}, ${PASSAGE_SCAN_CHARS}) end`,
    })
    .from(itemSearch)
    .leftJoin(
      itemBody,
      and(eq(itemBody.accountId, itemSearch.accountId), eq(itemBody.itemId, itemSearch.itemId)),
    )
    .where(
      and(
        eq(itemSearch.accountId, accountId),
        inArray(
          itemSearch.itemId,
          shown.map(({ id }) => id),
        ),
      ),
    );

  const fieldsOf = new Map(shown.map(({ fields, id }) => [id, fields]));
  const find = termMatch(terms);
  const passages = new Map<string, string>();

  for (const row of rows) {
    const fields = fieldsOf.get(row.id);

    const meta =
      fields === undefined || row.digest === null ? "" : deriveItem(fields, row.digest).search.meta;

    const passage = (row.text === null ? null : passageIn(row.text, find)) ?? passageIn(meta, find);

    if (passage !== null) {
      passages.set(row.id, passage);
    }
  }

  return passages;
};

export const searchHits = async (
  db: DbExecutor,
  accountId: string,
  query: string,
  side: SearchSide,
) => {
  const ranked = await rankedHits(db, accountId, query, side);
  const rank = new Map(ranked.ids.map((id, place) => [id, place]));
  const literal = new Set<string>();

  if (side === "live" && query.length >= LITERAL_MIN_CHARS && isPrintableAscii(query)) {
    let after: string | null = null;

    while (rank.size < SEARCH_CANDIDATES) {
      const page: string[] = await literalMatches(db, accountId, query, after);

      for (const id of page) {
        if (!rank.has(id) && rank.size < SEARCH_CANDIDATES) {
          rank.set(id, rank.size);
          literal.add(id);
        }
      }

      const last: string | undefined = page.at(-1);

      if (last === undefined || page.length < LITERAL_PAGE) {
        break;
      }

      after = last;
    }
  }

  return {
    passages: async (shown) => {
      const byLiteral = shown.filter(({ id }) => literal.has(id));
      const byWords = shown.filter(({ id }) => rank.has(id) && !literal.has(id));

      return new Map([
        ...(byLiteral.length === 0
          ? []
          : await literalPassages(
              db,
              accountId,
              byLiteral.map(({ id }) => id),
              query,
            )),
        ...(byWords.length === 0 ? [] : await rankedPassages(db, accountId, byWords, ranked.terms)),
      ]);
    },
    rank,
  } satisfies SearchHits;
};
