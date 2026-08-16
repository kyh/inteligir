// The knowledge routes, registered against the contract rows. Read-only:
// every handler settles the index (via the runtime) and answers from it.
// `tag:<name>` terms are parsed ENGINE-side (parseSearchQuery), so the route's
// grammar is the same one every other search surface gets. Paths are refused
// with the same rules the vault's own routes apply — answering an index query
// for a path the vault would refuse invites the client to then act on it.

import { SEARCH_DEFAULT_LIMIT } from "@repo/notes/knowledge/knowledge-index";
import { parseSearchQuery } from "@repo/notes/knowledge/vault-search";
import {
  KNOWLEDGE_BACKLINKS_MAX,
  KNOWLEDGE_RENAME_CANDIDATES_MAX,
  KNOWLEDGE_TAGS_MAX,
  knowledgeRoutes,
} from "@repo/server-contract/knowledge";
import type { ApiErrorResponse } from "@repo/server-contract/routes";
import type { TypedRoutesRegistrars } from "@repo/typed-routes/typed-routes";
import { normalizeVaultPath, VaultPathError } from "../vault/vault-paths";
import type { KnowledgeRuntime } from "./knowledge-runtime";

function invalidPath(error: VaultPathError): ApiErrorResponse {
  return { error: "invalid_path", message: error.message };
}

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
    try {
      const path = normalizeVaultPath(query.path);
      const backlinks = await knowledge.backlinks(path);
      return c.json({
        path,
        backlinks: backlinks.slice(0, KNOWLEDGE_BACKLINKS_MAX),
        total: backlinks.length,
      });
    } catch (error) {
      if (error instanceof VaultPathError) return c.json(invalidPath(error), 400);
      throw error;
    }
  });

  get(knowledgeRoutes.tags, async (c) => {
    const tags = await knowledge.tags();
    return c.json({ tags: tags.slice(0, KNOWLEDGE_TAGS_MAX), total: tags.length });
  });

  get(knowledgeRoutes.renameCandidates, async (c, query) => {
    try {
      const candidates = await knowledge.renameCandidates(
        normalizeVaultPath(query.from),
        normalizeVaultPath(query.to),
      );
      return c.json({
        candidates: candidates.slice(0, KNOWLEDGE_RENAME_CANDIDATES_MAX),
        total: candidates.length,
      });
    } catch (error) {
      if (error instanceof VaultPathError) return c.json(invalidPath(error), 400);
      throw error;
    }
  });
}
