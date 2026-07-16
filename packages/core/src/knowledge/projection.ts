// ---------------------------------------------------------------------------
// Doc projection — the ONE parse of a markdown doc, shaped for persistence.
// `projectDoc` wraps scanDoc (same remark pipeline the editor runs) and adds
// what the derived indexes need beyond the raw scan: the resolved title
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
import { scanDoc, titleFromPath } from "./link-extract";

/** Bump whenever `projectDoc`'s OUTPUT shape or semantics change — persisted
 * projections from another version are discarded and rebuilt from the vault. */
export const PROJECTION_VERSION = 2; // 2: docs gained `private` (frontmatter private: true)

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
  /** Frontmatter `private: true` (malformed frontmatter reads true — the
   * index prefilters fail-closed; AI surfaces re-probe live disk anyway). */
  private: boolean;
};

/** Parse a doc once into its projection. Pure: same bytes, same output. */
export function projectDoc(path: string, content: string): DocProjection {
  const scan = scanDoc(content);
  const lines = content.split(/\r\n|\r|\n/);
  const links = scan.links.map(
    (link): StoredLink => ({ ...link, snippet: clipSnippet((lines[link.line - 1] ?? "").trim()) }),
  );
  return {
    title: scan.title ?? titleFromPath(path),
    headings: scan.headings,
    links,
    tags: scan.tags,
    private: scan.private,
  };
}
