/**
 * Knowledge extension — exposes the derived knowledge indexes (lexical search,
 * backlinks, forward links) and the link-aware rename as agent tools. The
 * indexes live OUTSIDE the vault (rebuilt per device from its files), so the
 * agent's native file tools can't reach them — and a raw `bash mv` can't
 * rewrite the links they track — hence the capabilities arrive through
 * `ports.knowledge` (built main-side in boot/agent-wiring.ts). Pure
 * in-process: no CLI, no setup().
 *
 * search_vault / get_backlinks / get_links / related_notes are read-only, so
 * there is no confirmation gating (mirrors how the browser/executor tools
 * leave non-mutating calls ungated). rename_note mutates, but only via the
 * same reversible pipeline a user rename takes — no gating there either.
 *
 * RESULT ENCODING: the four read tools return `jsonResult`
 * (../extension-helpers) — the shared, delimiter-safe encoding every
 * vault-text tool uses, and the reason why is stated there. rename_note stays
 * prose: its result is our own outcome sentence, not vault text.
 */

import { Type, type Static } from "@sinclair/typebox";

import { NotePathSchema } from "@repo/bridge/ipc-registry";
import type { SearchResult } from "@repo/notes/knowledge/knowledge-index";
import { searchVaultNotes } from "@repo/notes/knowledge/vault-search";

import type { PiExtensionBundle } from "../extension";
import { grantedDescription, jsonResult, textResult } from "../extension-helpers";

// Keep result payloads bounded — the search index can match a lot of notes and
// each hit costs tokens. 20 is a useful-by-default window; 50 is the ceiling a
// caller can opt into.
const SEARCH_DEFAULT_LIMIT = 20;
const SEARCH_MAX_LIMIT = 50;

// get_backlinks takes no limit argument (the agent asks about one note, and
// "how many notes link here" is the answer), so it needs a ceiling of its own
// — a hub note in a large vault can be linked from hundreds of places, and an
// uncapped join is one of the few tool results here that has no bound at all.
// Stated in the tool description, the same way SEARCH_MAX_LIMIT is: the
// contract is documented, not signalled in-band.
const BACKLINKS_MAX = 200;

// get_links has the same no-limit-argument shape, and needs the ceiling for
// the mirror-image reason: a note's outgoing links are bounded by its own
// length rather than by the vault, but an index/MOC note exists precisely to
// link everything, so "one note" is not a bound in practice. Same order as
// BACKLINKS_MAX, and stated in the tool description the same way.
const LINKS_MAX = 200;

/** A tag listing carries no matched line, so an empty snippet drops out rather
 * than shipping a meaningless `"snippet": ""` for the model to read. */
function searchRow(hit: SearchResult): { path: string; snippet?: string } {
  return hit.snippet === "" ? { path: hit.path } : { path: hit.path, snippet: hit.snippet };
}

/** One get_links row. A dangling link has no file behind it, so it carries the
 * raw target text plus an explicit flag INSTEAD of a path — the two cases are
 * disjoint by construction, so no row can ever ship `"path": null` (or, worse,
 * the string "undefined") and read as a real target the agent then tries to
 * open. */
type LinkRow = { path: string } | { target: string; unresolved: true };

const SearchVaultSchema = Type.Object({
  query: Type.Optional(
    Type.String({
      description:
        "Terms to match against note titles and body text. Optional when `tag` is set, which then lists every note carrying it.",
    }),
  ),
  tag: Type.Optional(
    Type.String({
      description:
        "Restrict to notes carrying this tag (case-insensitive; inline `#tag` or frontmatter `tags`). Combine with `query` to search within it.",
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      description: `Max hits to return (default ${SEARCH_DEFAULT_LIMIT}, hard-capped at ${SEARCH_MAX_LIMIT}).`,
    }),
  ),
});

const RenameNoteSchema = Type.Object({
  from: Type.String({
    description: "Current vault-relative path of the file to rename or move (e.g. 'notes/old.md').",
  }),
  to: Type.String({
    description:
      "New vault-relative path (e.g. 'notes/new.md', or 'archive/old.md' to move it). The " +
      "destination file name must be a valid note name.",
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
          `${grantedDescription("search_vault")} Each element is \`{path, snippet}\` ` +
          "(`snippet` is omitted when listing a tag with no query).",
        parameters: SearchVaultSchema,
        execute: async (_toolCallId, params: Static<typeof SearchVaultSchema>) => {
          const query = params.query ?? "";
          const tag = params.tag ?? "";
          if (query.trim() === "" && tag.trim() === "") {
            // An argument error, not a result — prose, so it can't be mistaken
            // for an empty hit list.
            return textResult("Provide a query or a tag to search.");
          }
          const hits = searchVaultNotes(ports.knowledge, {
            limit: Math.min(params.limit ?? SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT),
            query,
            tag,
          });
          return textResult(jsonResult(hits.map(searchRow)));
        },
      });

      pi.registerTool({
        name: "get_backlinks",
        label: "get_backlinks",
        description:
          `${grantedDescription("get_backlinks")} Each element is \`{path}\`; at most ` +
          `${BACKLINKS_MAX} are returned.`,
        parameters: NotePathSchema,
        execute: async (_toolCallId, params: Static<typeof NotePathSchema>) => {
          const hits = ports.knowledge.backlinks(params.path);
          // De-dupe by source path — a note can link to the target on several
          // lines, but the agent only needs the set of linking notes.
          const paths = [...new Set(hits.map((hit) => hit.sourcePath))];
          return textResult(jsonResult(paths.slice(0, BACKLINKS_MAX).map((path) => ({ path }))));
        },
      });

      pi.registerTool({
        name: "get_links",
        label: "get_links",
        description:
          `${grantedDescription("get_links")} Traverse outward with it. Each element is ` +
          "`{path}` for a resolved target, or `{target, unresolved: true}` for a link whose " +
          `note does not exist yet. De-duped; at most ${LINKS_MAX} are returned.`,
        parameters: NotePathSchema,
        execute: async (_toolCallId, params: Static<typeof NotePathSchema>) => {
          const entries = ports.knowledge.forwardLinks(params.path);
          // De-dupe the way the renderer's Links panel groups: by resolved
          // target path, and by RAW TARGET TEXT when the link dangles, so
          // several refs to the same not-yet-created name collapse into one
          // row without colliding with a real path. Map preserves first-
          // insertion order, i.e. the note's own document order — which
          // carries authorial meaning the index doesn't reproduce.
          const rows = new Map<string, LinkRow>();
          for (const entry of entries) {
            const targetPath = entry.targetPath;
            if (targetPath === null) {
              rows.set(`unresolved:${entry.target}`, { target: entry.target, unresolved: true });
            } else {
              rows.set(`path:${targetPath}`, { path: targetPath });
            }
          }
          return textResult(jsonResult([...rows.values()].slice(0, LINKS_MAX)));
        },
      });

      pi.registerTool({
        name: "related_notes",
        label: "related_notes",
        description:
          `${grantedDescription("related_notes")} Use it for "what else touches this ` +
          'topic?". Each element is `{path, reasons}`, reasons being an array of strings.',
        parameters: NotePathSchema,
        execute: async (_toolCallId, params: Static<typeof NotePathSchema>) => {
          const hits = ports.knowledge.relatedNotes(params.path);
          // `reasons` stays an array rather than a "; "-joined string: the same
          // delimiter argument as the row separator, one level down.
          return textResult(
            jsonResult(hits.map((hit) => ({ path: hit.path, reasons: hit.reasons }))),
          );
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
        description: grantedDescription("rename_note"),
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
