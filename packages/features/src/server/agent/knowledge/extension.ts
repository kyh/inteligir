/**
 * Knowledge extension — exposes the derived knowledge indexes (lexical search,
 * backlinks) as agent tools. These indexes live OUTSIDE the vault (rebuilt per
 * device, never synced), so the agent's native file tools can't reach them —
 * the capability arrives through `ports.knowledge` (built main-side in
 * agent-lifecycle.ts). Pure in-process: no CLI, no setup().
 *
 * Both tools are read-only, so there is no confirmation gating (mirrors how
 * the browser/executor tools leave non-mutating calls ungated).
 */

import { Type, type Static } from "@sinclair/typebox";

import type { PiExtensionBundle } from "../extension";
import { textResult } from "../extension-helpers";

// Keep result payloads bounded — the search index can match a lot of notes and
// each hit costs tokens. 20 is a useful-by-default window; 50 is the ceiling a
// caller can opt into.
const SEARCH_DEFAULT_LIMIT = 20;
const SEARCH_MAX_LIMIT = 50;

const SearchVaultSchema = Type.Object({
  query: Type.Optional(
    Type.String({
      description:
        "Search terms to match against note titles and body text. Optional when `tag` is set (then it lists every note with that tag).",
    }),
  ),
  tag: Type.Optional(
    Type.String({
      description:
        "Restrict results to notes carrying this tag (case-insensitive; matches inline `#tag` and frontmatter `tags`). Combine with `query` to search within the tag.",
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      description: `Max hits to return (default ${SEARCH_DEFAULT_LIMIT}, hard-capped at ${SEARCH_MAX_LIMIT}).`,
    }),
  ),
});

const GetBacklinksSchema = Type.Object({
  path: Type.String({
    description: "Vault-relative note path (e.g. 'notes/ideas.md') to find links pointing to it.",
  }),
});

const knowledgeExtension: PiExtensionBundle = {
  name: "knowledge",
  register:
    ({ ports }) =>
    (pi) => {
      pi.registerTool({
        name: "search_vault",
        label: "search_vault",
        description:
          "Full-text search over the user's vault (lexical, ranked). Returns matching " +
          "note paths with snippets. Optionally filter by `tag` (inline `#tag` or " +
          "frontmatter `tags`). Prefer this over grep for finding notes by topic.",
        parameters: SearchVaultSchema,
        execute: async (_toolCallId, params: Static<typeof SearchVaultSchema>) => {
          const limit = Math.min(params.limit ?? SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT);
          const query = params.query?.trim();
          if (params.tag !== undefined) {
            // Tag filter first, then the query narrows WITHIN the tagged set.
            const tagged = new Set(ports.knowledge.notesWithTag(params.tag));
            if (tagged.size === 0) return textResult("No matches.");
            if (query === undefined || query === "") {
              return textResult([...tagged].toSorted().slice(0, limit).join("\n"));
            }
            const hits = ports.knowledge.search(query, limit).filter((hit) => tagged.has(hit.path));
            if (hits.length === 0) return textResult("No matches.");
            return textResult(hits.map((hit) => `${hit.path} — ${hit.snippet}`).join("\n"));
          }
          if (query === undefined || query === "") {
            return textResult("Provide a query or a tag to search.");
          }
          const hits = ports.knowledge.search(query, limit);
          if (hits.length === 0) return textResult("No matches.");
          return textResult(hits.map((hit) => `${hit.path} — ${hit.snippet}`).join("\n"));
        },
      });

      pi.registerTool({
        name: "get_backlinks",
        label: "get_backlinks",
        description:
          "Notes that link TO the given vault-relative note path (wiki-links and markdown links).",
        parameters: GetBacklinksSchema,
        execute: async (_toolCallId, params: Static<typeof GetBacklinksSchema>) => {
          const hits = ports.knowledge.backlinks(params.path);
          if (hits.length === 0) return textResult("No backlinks.");
          // De-dupe by source path — a note can link to the target on several
          // lines, but the agent only needs the set of linking notes.
          const paths = [...new Set(hits.map((hit) => hit.sourcePath))];
          return textResult(paths.join("\n"));
        },
      });
    },
};

export default knowledgeExtension;
