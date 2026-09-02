import { SEARCH_DEFAULT_LIMIT } from "@repo/notes/knowledge/knowledge-index";
import { RELATED_DEFAULT_LIMIT } from "@repo/notes/knowledge/related-notes";
import { parseSearchQuery } from "@repo/notes/knowledge/vault-search";
import {
  KNOWLEDGE_BACKLINKS_MAX,
  KNOWLEDGE_TAGS_MAX,
} from "@repo/api/local/knowledge/knowledge-schema";
import { base } from "../orpc";

const search = base.knowledge.search.handler(async ({ context, input }) => {
  const { query: text, tag } = parseSearchQuery(input.q);
  const results = await context.knowledge.search({
    query: text,
    tag,
    limit: input.limit ?? SEARCH_DEFAULT_LIMIT,
  });
  return { results };
});

const wikiTargets = base.knowledge.wikiTargets.handler(async ({ context }) => ({
  targets: await context.knowledge.wikiTargets(),
}));

const backlinks = base.knowledge.backlinks.handler(async ({ context, input }) => {
  const found = await context.knowledge.backlinks(input.path);
  return {
    path: input.path,
    backlinks: found.slice(0, KNOWLEDGE_BACKLINKS_MAX),
    total: found.length,
  };
});

const related = base.knowledge.related.handler(async ({ context, input }) => ({
  path: input.path,
  related: await context.knowledge.relatedNotes(input.path, input.limit ?? RELATED_DEFAULT_LIMIT),
}));

const tags = base.knowledge.tags.handler(async ({ context }) => {
  const found = await context.knowledge.tags();
  return { tags: found.slice(0, KNOWLEDGE_TAGS_MAX), total: found.length };
});

export const knowledgeRouter = {
  search,
  wikiTargets,
  backlinks,
  related,
  tags,
};
