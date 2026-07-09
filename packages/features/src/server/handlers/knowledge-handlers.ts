import { getKnowledgeManager } from "../knowledge/knowledge-manager";
import type { HandlerRegistrar } from "../lib/handler-registry";

export function registerKnowledgeHandlers(handle: HandlerRegistrar): void {
  handle("getBacklinks", ({ path }) => getKnowledgeManager().backlinks(path));
  handle("getForwardLinks", ({ path }) => getKnowledgeManager().forwardLinks(path));
  handle("getLinkGraph", () => getKnowledgeManager().graph());
  handle("searchVault", ({ query, limit }) => getKnowledgeManager().search(query, limit));
  handle("listWikiTargets", () => getKnowledgeManager().wikiTargets());
  handle("listTags", () => getKnowledgeManager().tags());
  handle("getNotesByTag", ({ tag }) => getKnowledgeManager().notesWithTag(tag));
}
