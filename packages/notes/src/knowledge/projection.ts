// ---------------------------------------------------------------------------
// Doc projection — the ONE parse of a markdown doc, shaped for persistence.
// `projectDoc` wraps scanDoc (the scan's own grammar, ../markdown/scan-parse)
// and adds what the derived indexes need beyond the raw scan: the resolved title
// (heading or filename fallback) and a per-link source-line snippet, captured
// HERE so no downstream index ever has to retain doc bodies or line arrays.
//
// DocProjection is the single extension point for projection-derived state:
// a workstream that needs more per-doc data (aliases, tasks, …) extends this
// type, projects it here, and bumps PROJECTION_VERSION — the persistent store
// treats a version mismatch as "wipe and rebuild", so there is no migration
// machinery to write.
// ---------------------------------------------------------------------------

import type { ExtractedLink } from "./link-extract";
import { scanDoc } from "./link-extract";
import { docStem } from "./doc-file";
import { splitLines } from "./source-lines";
import type { ExtractedTask } from "./task-ordinal";

/** Bump whenever `projectDoc`'s OUTPUT shape or semantics change — persisted
 * projections from another version are discarded and rebuilt from the vault. */
export const PROJECTION_VERSION = 10;

const SNIPPET_MAX = 200;

/** Clip snippet text to a bounded display length. */
export function clipSnippet(text: string): string {
  return text.length <= SNIPPET_MAX ? text : `${text.slice(0, SNIPPET_MAX - 1)}…`;
}

/** An extracted link plus the trimmed source line it sits on — everything the
 * backlinks/forward-links panels render, captured at projection time. */
export type StoredLink = ExtractedLink & { snippet: string };

/** Everything the derived indexes keep per doc. Bodies are deliberately NOT
 * part of the projection — full-text search stores the body corpus itself. */
export type DocProjection = {
  /** First `#` heading, or the filename-derived fallback. Never empty. */
  title: string;
  /** Every heading's text, any depth, in document order. */
  headings: string[];
  links: StoredLink[];
  /** Display-case tags, deduped — frontmatter first, then inline. */
  tags: string[];
  /** Frontmatter `aliases`, display case, deduped case-insensitively — the
   * resolver's below-path tiers and the `[[` picker's extra keywords. */
  aliases: string[];
  /** The doc's GFM task items in ordinal order (empty under the `tasks:
   * false` opt-out). Persisted, and read by no query today: the scan counts
   * them regardless, so carrying the result costs one json field and no
   * second parse. */
  tasks: ExtractedTask[];
  /** Frontmatter `pinned: true` — the sidebar's pinned section. */
  pinned: boolean;
  /** Frontmatter `id:` — the identity `[[Title|uuid]]` links resolve through. */
  noteId: string | null;
};

/** Parse a doc once into its projection. Pure: same bytes, same output. */
export function projectDoc(path: string, content: string): DocProjection {
  const scan = scanDoc(content);
  const lines = splitLines(content);
  const links = scan.links.map(
    (link): StoredLink => ({ ...link, snippet: clipSnippet((lines[link.line - 1] ?? "").trim()) }),
  );
  return {
    title: scan.title ?? docStem(path),
    headings: scan.headings,
    links,
    tags: scan.tags,
    aliases: scan.aliases,
    tasks: scan.tasks,
    pinned: scan.pinned,
    noteId: scan.noteId,
  };
}
