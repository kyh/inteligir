// The knowledge routes, registered against the contract rows. Read-only:
// every handler settles the index (via the runtime) and answers from it.
// `tag:<name>` terms are parsed ENGINE-side (parseSearchQuery), so the route's
// grammar is the same one every other search surface gets. Paths arrive
// already parsed and normalized by `vaultPathSchema`, so nothing here can be
// handed a traversal to refuse.

import { SEARCH_DEFAULT_LIMIT } from "@repo/notes/knowledge/knowledge-index";
import { RELATED_DEFAULT_LIMIT } from "@repo/notes/knowledge/related-notes";
import { parseSearchQuery } from "@repo/notes/knowledge/vault-search";
import {
  KNOWLEDGE_BACKLINKS_MAX,
  KNOWLEDGE_RENAME_CANDIDATES_MAX,
  KNOWLEDGE_TAGS_MAX,
  knowledgeRoutes,
} from "@repo/server-contract/knowledge";
import type { TypedRoutesRegistrars } from "@repo/typed-routes/typed-routes";
import type { KnowledgeRuntime } from "./knowledge-runtime";

export function registerKnowledgeRoutes(
  registrars: Pick<TypedRoutesRegistrars, "get">,
  knowledge: KnowledgeRuntime,
): void {
  const { get } = registrars;

  get(knowledgeRoutes.search, async (c, query) => {
    const { query: text, tag } = parseSearchQuery(query.q);
    const results = await knowledge.search({
      query: text,
      tag,
      limit: query.limit ?? SEARCH_DEFAULT_LIMIT,
    });
    return c.json({ results });
  });

  get(knowledgeRoutes.backlinks, async (c, query) => {
    const backlinks = await knowledge.backlinks(query.path);
    return c.json({
      path: query.path,
      backlinks: backlinks.slice(0, KNOWLEDGE_BACKLINKS_MAX),
      total: backlinks.length,
    });
  });

  get(knowledgeRoutes.related, async (c, query) => {
    const related = await knowledge.relatedNotes(query.path, query.limit ?? RELATED_DEFAULT_LIMIT);
    return c.json({ path: query.path, related });
  });

  get(knowledgeRoutes.tags, async (c) => {
    const tags = await knowledge.tags();
    return c.json({ tags: tags.slice(0, KNOWLEDGE_TAGS_MAX), total: tags.length });
  });

  get(knowledgeRoutes.renameCandidates, async (c, query) => {
    const candidates = await knowledge.renameCandidates(query.from, query.to);
    return c.json({
      candidates: candidates.slice(0, KNOWLEDGE_RENAME_CANDIDATES_MAX),
      total: candidates.length,
    });
  });
}
