import type { z } from "zod";
import { parseItemTime } from "@repo/notes/items/item-time";
import type { ItemQuery } from "@repo/notes/items/library-index";
import { parseSearchQuery } from "@repo/notes/knowledge/vault-search";
import {
  KNOWLEDGE_BACKLINKS_MAX,
  KNOWLEDGE_FIND_BY_URL_MAX,
  KNOWLEDGE_ITEMS_SEARCH_MAX,
  KNOWLEDGE_TAGS_MAX,
} from "@repo/contract/local/knowledge/knowledge-schema";
import type {
  knowledgeItemsRequestSchema,
  KnowledgeRenameTagResponse,
} from "@repo/contract/local/knowledge/knowledge-schema";
import type { KnowledgeRuntime } from "./knowledge-runtime";
import { attributeWrites, base } from "../orpc";

export type RenameTag = (from: string, to: string) => Promise<KnowledgeRenameTagResponse>;

const search = base.knowledge.search.handler(async ({ context, input }) => {
  const { query: text, tag } = parseSearchQuery(input.q);
  const results = await context.knowledge.search({
    limit: input.limit,
    query: text,
    tag,
  });
  return { results };
});

const matches = base.knowledge.matches.handler(
  async ({ context, input }) =>
    await context.knowledge.matches({
      limit: input.limit,
      needle: input.q,
      options: { caseSensitive: input.caseSensitive, wholeWord: input.wholeWord },
    }),
);

const wikiTargets = base.knowledge.wikiTargets.handler(async ({ context }) => ({
  targets: await context.knowledge.wikiTargets(),
}));

const backlinks = base.knowledge.backlinks.handler(async ({ context, input }) => {
  const found = await context.knowledge.backlinks(input.path);
  return {
    backlinks: found.slice(0, KNOWLEDGE_BACKLINKS_MAX),
    path: input.path,
    total: found.length,
  };
});

const related = base.knowledge.related.handler(async ({ context, input }) => ({
  path: input.path,
  related: await context.knowledge.relatedNotes(input.path, input.limit),
}));

const tagNotes = base.knowledge.tagNotes.handler(async ({ context, input }) => {
  const page = await context.knowledge.tagNotes(input.tag, input.limit, input.offset);
  return { tag: input.tag, ...page };
});

const tags = base.knowledge.tags.handler(async ({ context }) => {
  const found = await context.knowledge.tags();
  return { tags: found.slice(0, KNOWLEDGE_TAGS_MAX), total: found.length };
});

const renameTag = base.knowledge.renameTag.handler(async ({ context, input }) => {
  const renamed = await context.renameTag(input.from, input.to);
  attributeWrites(context, renamed.rewritten);
  return renamed;
});

type ItemFilterInput = Omit<z.output<typeof knowledgeItemsRequestSchema>, "limit" | "offset">;

// the wire's filter as the index asks it: `since` read as an instant (the schema refused any
// other), `q` as the ranked search's top hits by rank, and the sort relevance only when asked
// with a q. exact-optional, so an absent filter is absent
const itemQueryOf = async (
  knowledge: Pick<KnowledgeRuntime, "search">,
  input: ItemFilterInput,
  page: { limit: number; offset: number },
): Promise<ItemQuery> => {
  const query: ItemQuery = {
    limit: page.limit,
    offset: page.offset,
    sort: input.sort ?? (input.q === undefined ? "saved" : "relevance"),
    subfolders: input.subfolders,
    untagged: input.untagged,
  };
  if (input.kinds !== undefined) {
    query.kinds = input.kinds;
  }
  if (input.folder !== undefined) {
    query.folder = input.folder;
  }
  if (input.tag !== undefined) {
    query.tag = input.tag;
  }
  if (input.site !== undefined) {
    query.site = input.site;
  }
  const sinceMs = input.since === undefined ? null : parseItemTime(input.since);
  if (sinceMs !== null) {
    query.sinceMs = sinceMs;
  }
  if (input.q !== undefined) {
    const hits = await knowledge.search({ limit: KNOWLEDGE_ITEMS_SEARCH_MAX, query: input.q });
    query.within = new Map(hits.map((hit, rank) => [hit.path, rank]));
  }
  return query;
};

const items = base.knowledge.items.handler(async ({ context, input }) => {
  const { limit, offset, ...filter } = input;
  return await context.knowledge.items(
    await itemQueryOf(context.knowledge, filter, { limit, offset }),
  );
});

const itemPaths = base.knowledge.itemPaths.handler(async ({ context, input }) => {
  const { limit, offset, ...filter } = input;
  return await context.knowledge.itemPaths(
    await itemQueryOf(context.knowledge, filter, { limit, offset }),
  );
});

const itemsAt = base.knowledge.itemsAt.handler(async ({ context, input }) => ({
  items: await context.knowledge.itemsAt(input.paths),
}));

const findByUrl = base.knowledge.findByUrl.handler(
  async ({ context, input }) =>
    await context.knowledge.findByUrl(input.url, KNOWLEDGE_FIND_BY_URL_MAX),
);

const scopes = base.knowledge.scopes.handler(
  async ({ context }) => await context.knowledge.scopes(),
);

const pathForNoteId = base.knowledge.pathForNoteId.handler(async ({ context, input }) => ({
  path: await context.knowledge.pathForNoteId(input.id, input.lastPath),
}));

export const knowledgeRouter = {
  backlinks,
  findByUrl,
  itemPaths,
  items,
  itemsAt,
  pathForNoteId,
  scopes,
  matches,
  related,
  renameTag,
  search,
  tagNotes,
  tags,
  wikiTargets,
};
