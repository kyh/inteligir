// A search's hits, best first, in two tiers: the items whose vector matches the query's words
// (`./search-vector`), ranked by ts_rank under each field's weight, then the live items whose text
// holds the query's exact text, which words miss (a part of a word, punctuation: `parse_v2(`). A
// query is a tsquery literal built from the one tokenizer (`./search-query`), never Postgres's own
// parse of it, whose words are not ours and would split a stem's `~`. A hit is an id until a page
// shows it, and its passage is cut then (`./search-excerpt`), so a search reads the text of a
// page's rows and no other.

import { deriveItem } from "@repo/contract/library/derive-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import type { DbExecutor } from "@repo/db/drizzle-client";
import { item, itemBody, itemSearch } from "@repo/db/library-schema";
import { findTextOffsets } from "@repo/editor/headless/knowledge/text-matches";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { passageIn, termMatch } from "./search-excerpt";
import { planSearchQuery } from "./search-query";
import type { SearchQueryPlan, SearchQueryTerm } from "./search-query";
import { lexemeLiteral } from "./search-vector";

// the side of Deleted a search answers from: an item in Deleted is found only from Deleted itself
export type SearchSide = "live" | "deleted";

// how many hits a search ranks before a listing's filters, and how many items holding its exact
// text one read of the text names at once
const SEARCH_CANDIDATES = 200;
const LITERAL_PAGE = 50;

// trigrams cannot narrow a shorter needle, which the ranked tier's prefix already finds
const LITERAL_MIN_CHARS = 3;

// how far into a body a ranked hit's passage is looked for; a hit past it shows its title
const PASSAGE_SCAN_CHARS = 64 * 1024;

// how much text either side of a literal hit's first place is read to cut its passage from, far
// more than the passage keeps either side
const LITERAL_PASSAGE_REACH = 2048;

// the plan as a tsquery literal: each term its word, a prefix while it is still being typed, or its
// stem's shadow, which no prefix reaches
export const tsqueryOf = (plan: SearchQueryPlan): string =>
  plan.terms
    .map(
      (term) =>
        `(${lexemeLiteral(term.token)}${term.prefix ? ":*" : ""} | ${lexemeLiteral(`~${term.stem}`)})`,
    )
    .join(plan.match === "all" ? " & " : " | ");

const PRINTABLE_ASCII = /^[ -~]+$/u;

// the needles Postgres's lower() and the editor's matcher fold alike, each on one line
export const isPrintableAscii = (needle: string): boolean => PRINTABLE_ASCII.test(needle);

// a text as a LIKE pattern matches it literally, a backslash its escape
export const likeLiteral = (text: string): string => text.replaceAll(/[\\%_]/gu, "\\$&");

const holding = (needle: string) =>
  sql`lower(${itemSearch.text}) like ${`%${likeLiteral(needle.toLowerCase())}%`} escape '\\'`;

const itemOfSearchRow = and(
  eq(item.accountId, itemSearch.accountId),
  eq(item.id, itemSearch.itemId),
);

// ids are compared by code point, as the library model orders them
const idOrder = sql`${itemSearch.itemId} collate "C"`;

interface Ranked {
  readonly ids: readonly string[];
  // what the vector matched them by
  readonly terms: readonly SearchQueryTerm[];
}

// the policy's plans in turn, every term required first, until one finds anything
const rankedHits = async (
  db: DbExecutor,
  accountId: string,
  query: string,
  side: SearchSide,
): Promise<Ranked> => {
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
      return { ids: rows.map((row) => row.id), terms: plan.terms };
    }
  }
  return { ids: [], terms: [] };
};

// the live items whose text holds `needle`, in id order after `after`, a page of them
const literalMatches = async (
  db: DbExecutor,
  accountId: string,
  needle: string,
  after: string | null,
): Promise<string[]> => {
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

// an item a page shows, which a hit's passage is cut for: its fields say what its meta holds
interface ShownHit {
  readonly id: string;
  readonly fields: LibraryItemFields;
}

export interface SearchHits {
  // each hit's place, best first
  readonly rank: ReadonlyMap<string, number>;
  // the passage each shown hit was found by; none for a hit only its title or headings hold
  readonly passages: (shown: readonly ShownHit[]) => Promise<ReadonlyMap<string, string>>;
}

// the first line of each item's text holding `needle`, read around its first place
const literalPassages = async (
  db: DbExecutor,
  accountId: string,
  ids: readonly string[],
  needle: string,
): Promise<Map<string, string>> => {
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

// a line of each item's body opening holding a term as the vector matched it, else of what its
// fields and tags say of it
const rankedPassages = async (
  db: DbExecutor,
  accountId: string,
  shown: readonly ShownHit[],
  terms: readonly SearchQueryTerm[],
): Promise<Map<string, string>> => {
  const rows = await db
    .select({
      digest: itemBody.digest,
      id: itemSearch.itemId,
      text: sql<string>`left(${itemSearch.text}, ${PASSAGE_SCAN_CHARS})`,
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
    const passage = passageIn(row.text, find) ?? passageIn(meta, find);
    if (passage !== null) {
      passages.set(row.id, passage);
    }
  }
  return passages;
};

// The ranked tier, then the live items holding the query's exact text, a page of them at a time
// until the candidates are full, so a common needle names no more of the library than those pages;
// only a printable ASCII needle of a few characters has such a scan, which Postgres folds as the
// editor's matcher does and a trigram index narrows
export const searchHits = async (
  db: DbExecutor,
  accountId: string,
  query: string,
  side: SearchSide,
): Promise<SearchHits> => {
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
  };
};
