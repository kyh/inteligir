// The knowledge routes, registered against the contract rows. Read-only:
// every handler settles the index (via the runtime) and answers from it.
// `tag:<name>` terms are parsed ENGINE-side (parseSearchQuery), so the route's
// grammar is the same one every other search surface gets.

import { SEARCH_DEFAULT_LIMIT } from "@repo/notes/knowledge/knowledge-index";
import { parseSearchQuery } from "@repo/notes/knowledge/vault-search";
import { knowledgeRoutes } from "@repo/server-contract/knowledge";
import type { ApiErrorResponse } from "@repo/server-contract/routes";
import type { TypedRoutesRegistrars } from "@repo/typed-routes/typed-routes";
import { normalizeVaultPath, VaultPathError } from "../vault/vault-paths";
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
    return c.json({ path: query.path, backlinks: await knowledge.backlinks(query.path) });
  });

  get(knowledgeRoutes.tags, async (c) => c.json({ tags: await knowledge.tags() }));

  // Candidates are pure index reads, but a hostile path gets the same refusal
  // the vault gives it — answering would invite the rename attempt itself.
  get(knowledgeRoutes.renameCandidates, async (c, query) => {
    try {
      const candidates = await knowledge.renameCandidates(
        normalizeVaultPath(query.from),
        normalizeVaultPath(query.to),
      );
      return c.json({ candidates });
    } catch (error) {
      if (error instanceof VaultPathError) {
        const body: ApiErrorResponse = { error: "invalid_path", message: error.message };
        return c.json(body, 400);
      }
      throw error;
    }
  });
}
