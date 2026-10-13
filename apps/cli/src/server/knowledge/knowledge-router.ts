import { parseSearchQuery } from "@repo/notes/knowledge/vault-search";
import {
  KNOWLEDGE_BACKLINKS_MAX,
  KNOWLEDGE_TAGS_MAX,
} from "@repo/contract/local/knowledge/knowledge-schema";
import type { KnowledgeRenameTagResponse } from "@repo/contract/local/knowledge/knowledge-schema";
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

const unlinkedMentions = base.knowledge.unlinkedMentions.handler(async ({ context, input }) => ({
  path: input.path,
  ...(await context.knowledge.unlinkedMentions(input.path, input.limit)),
}));

const problems = base.knowledge.problems.handler(
  async ({ context, input }) =>
    await context.knowledge.problems({
      includeConventionFolders: input.includeConventionFolders,
      limit: input.limit,
    }),
);

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
