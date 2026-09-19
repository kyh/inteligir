import { SEARCH_DEFAULT_LIMIT } from "@repo/notes/knowledge/knowledge-index";
import { RELATED_DEFAULT_LIMIT } from "@repo/notes/knowledge/related-notes";
import { parseSearchQuery } from "@repo/notes/knowledge/vault-search";
import {
  KNOWLEDGE_BACKLINKS_MAX,
  KNOWLEDGE_MATCHES_DEFAULT_LIMIT,
  KNOWLEDGE_PROBLEMS_DEFAULT_LIMIT,
  KNOWLEDGE_TAG_NOTES_DEFAULT_LIMIT,
  KNOWLEDGE_TAGS_MAX,
  KNOWLEDGE_UNLINKED_DEFAULT_LIMIT,
} from "@repo/api/local/knowledge/knowledge-schema";
import type { KnowledgeRenameTagResponse } from "@repo/api/local/knowledge/knowledge-schema";
import { base } from "../orpc";

export type RenameTag = (from: string, to: string) => Promise<KnowledgeRenameTagResponse>;

const search = base.knowledge.search.handler(async ({ context, input }) => {
  const { query: text, tag } = parseSearchQuery(input.q);
  const results = await context.knowledge.search({
    limit: input.limit ?? SEARCH_DEFAULT_LIMIT,
    query: text,
    tag,
  });
  return { results };
});

const matches = base.knowledge.matches.handler(
  async ({ context, input }) =>
    await context.knowledge.matches({
      limit: input.limit ?? KNOWLEDGE_MATCHES_DEFAULT_LIMIT,
      needle: input.q,
      options: { caseSensitive: input.caseSensitive ?? false, wholeWord: input.wholeWord ?? false },
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

const unlinkedMentions = base.knowledge.unlinkedMentions.handler(async ({ context, input }) => ({
  path: input.path,
  ...(await context.knowledge.unlinkedMentions(
    input.path,
    input.limit ?? KNOWLEDGE_UNLINKED_DEFAULT_LIMIT,
  )),
}));

const problems = base.knowledge.problems.handler(
  async ({ context, input }) =>
    await context.knowledge.problems({
      includeConventionFolders: input.includeConventionFolders ?? false,
      limit: input.limit ?? KNOWLEDGE_PROBLEMS_DEFAULT_LIMIT,
    }),
);

const related = base.knowledge.related.handler(async ({ context, input }) => ({
  path: input.path,
  related: await context.knowledge.relatedNotes(input.path, input.limit ?? RELATED_DEFAULT_LIMIT),
}));

const tagNotes = base.knowledge.tagNotes.handler(async ({ context, input }) => {
  const page = await context.knowledge.tagNotes(
    input.tag,
    input.limit ?? KNOWLEDGE_TAG_NOTES_DEFAULT_LIMIT,
    input.offset ?? 0,
  );
  return { tag: input.tag, ...page };
});

const tags = base.knowledge.tags.handler(async ({ context }) => {
  const found = await context.knowledge.tags();
  return { tags: found.slice(0, KNOWLEDGE_TAGS_MAX), total: found.length };
});

const renameTag = base.knowledge.renameTag.handler(
  async ({ context, input }) => await context.renameTag(input.from, input.to),
);

export const knowledgeRouter = {
  backlinks,
  matches,
  problems,
  related,
  renameTag,
  search,
  tagNotes,
  tags,
  unlinkedMentions,
  wikiTargets,
};
