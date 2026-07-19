/**
 * Knowledge extension — exposes the derived knowledge indexes (lexical search,
 * backlinks) and the link-aware rename as agent tools. The indexes live
 * OUTSIDE the vault (rebuilt per device, never synced), so the agent's native
 * file tools can't reach them — and a raw `bash mv` can't rewrite the links
 * they track — hence the capabilities arrive through `ports.knowledge` (built
 * main-side in boot/agent-wiring.ts). Pure in-process: no CLI, no setup().
 *
 * search_vault / get_backlinks are read-only, so there is no confirmation
 * gating (mirrors how the browser/executor tools leave non-mutating calls
 * ungated). rename_note mutates, but only via the same reversible pipeline a
 * user rename takes — no gating there either.
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

const RenameNoteSchema = Type.Object({
  from: Type.String({
    description: "Current vault-relative path of the file to rename or move (e.g. 'notes/old.md').",
  }),
  to: Type.String({
    description:
      "New vault-relative path (e.g. 'notes/new.md', or 'archive/old.md' to move it). " +
      "The destination file name must be a valid note name.",
  }),
});

const knowledgeExtension: PiExtensionBundle = {
  name: "knowledge-tools",
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

      // The one mutating tool here. Privacy: rename_note is deliberately NOT
      // in the gate's curated KNOWLEDGE_TOOLS set — it falls through to the
      // unknown-tool arg screen (privacy/gate.ts decideOpaqueInput), so an
      // argument naming an indexed private note blocks the call before this
      // execute runs; the port re-probes the source against live disk on top
      // (agent-knowledge-port.ts renameNote). Do not add it to the curated
      // set without giving the gate a real per-path decision for it.
      pi.registerTool({
        name: "rename_note",
        label: "rename_note",
        description:
          "Rename or move a vault file, rewriting every [[wiki-link]] and markdown link " +
          "that pointed at it across the whole vault and recording the old title as a " +
          "frontmatter alias so stale references still resolve. ALWAYS use this to " +
          "rename/move notes — never `bash mv` and never write-to-a-new-path + delete, " +
          "because those bypass the link rewrite and dangle every inbound link.",
        parameters: RenameNoteSchema,
        execute: async (_toolCallId, params: Static<typeof RenameNoteSchema>) => {
          const result = ports.knowledge.rename(params.from, params.to);
          if (!result.ok) return textResult(`Rename failed: ${result.reason}`);
          const links =
            result.linksRewritten === 0
              ? "No link rewrites were needed."
              : `Rewrote links in ${result.linksRewritten} note${result.linksRewritten === 1 ? "" : "s"}.`;
          return textResult(`Renamed ${result.from} to ${result.to}. ${links}`);
        },
      });
    },
};

export default knowledgeExtension;
