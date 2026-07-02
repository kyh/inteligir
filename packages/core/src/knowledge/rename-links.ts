// ---------------------------------------------------------------------------
// Rename-rewrite: when a vault file moves `from` → `to`, compute the minimal
// byte-surgical edits that keep every link pointing at it. Pure — the host
// applies the returned contents through VaultManager's atomic writes; the
// fixture bridge applies them to its in-memory Map.
//
// Only the recorded target span of each link changes (extraction emits spans
// exclusively after byte verification): aliases (`[[old|alias]]`), anchors
// (`[[old#sec]]`), body padding, and `<>` url wrappers all survive verbatim.
// Links inside fences/code spans were never extracted, so they are never
// touched. Two link populations are rewritten:
//   1. links in ANY doc that resolve to `from` (including self-links inside
//      the moved doc) — retargeted at `to`;
//   2. relative md links FROM the moved doc to other files — re-based when
//      the move changed directories (wiki links are location-independent).
// ---------------------------------------------------------------------------

import type { Span } from "./link-extract";
import { scanDoc } from "./link-extract";
import { buildResolver, type TargetResolver } from "./link-resolve";
import { basenamePath, dirnamePath, extnamePath, normalizePath, relativePath } from "./vault-path";

/**
 * Compute rewritten doc contents for a `from` → `to` file rename.
 *
 * @param docs     Pre-rename doc contents, keyed by pre-rename vault path
 *                 (including `from` itself when it is a doc).
 * @param allFiles Every pre-rename vault file path (docs and other files) —
 *                 the resolution universe.
 * @returns Changed docs only, keyed by POST-rename path (the moved doc's own
 *          edit is keyed at `to`).
 */
export function computeRenameEdits(
  docs: ReadonlyMap<string, string>,
  allFiles: Iterable<string>,
  from: string,
  to: string,
): Map<string, string> {
  const edits = new Map<string, string>();
  const fromPath = normalizePath(from);
  const toPath = normalizePath(to);
  if (fromPath === toPath || fromPath === "" || toPath === "") return edits;

  const files = [...new Set([...allFiles].map(normalizePath))];
  const preResolver = buildResolver(files);
  const postFiles = files.map((p) => (p === fromPath ? toPath : p));
  const postResolver = buildResolver(postFiles);
  // Resolver over everything EXCEPT the renamed file — proves a short wiki
  // name is truly unambiguous, not merely winning a tie-break.
  const othersResolver = buildResolver(postFiles.filter((p) => p !== toPath));
  const movedDirs = dirnamePath(fromPath) !== dirnamePath(toPath);

  for (const [docPath, content] of docs) {
    const path = normalizePath(docPath);
    const postDocPath = path === fromPath ? toPath : path;
    const replacements: Array<{ span: Span; text: string }> = [];

    for (const link of scanDoc(content).links) {
      if (!link.targetSpan) continue;
      const raw = content.slice(link.targetSpan.start, link.targetSpan.end);
      const resolved =
        link.kind === "wiki"
          ? preResolver.resolveWiki(link.target)
          : preResolver.resolveMd(link.target, path);
      let text: string | null = null;
      if (resolved === fromPath) {
        text =
          link.kind === "wiki"
            ? wikiTargetText(toPath, fromPath, postResolver, othersResolver, raw)
            : mdUrlText(postDocPath, toPath, raw);
      } else if (link.kind === "md" && path === fromPath && movedDirs && resolved !== null) {
        // The moved doc's own outgoing relative md links re-base to its new
        // directory (wiki links resolve by name and need no rewrite).
        text = mdUrlText(toPath, resolved, raw);
      }
      if (text !== null && text !== raw) replacements.push({ span: link.targetSpan, text });
    }

    if (replacements.length === 0) continue;
    edits.set(postDocPath, applyReplacements(content, replacements));
  }
  return edits;
}

/** Splice replacements back-to-front so earlier spans stay valid. Spans come
 * from one extraction pass over `content` and never overlap. */
function applyReplacements(
  content: string,
  replacements: Array<{ span: Span; text: string }>,
): string {
  const ordered = replacements.toSorted((a, b) => b.span.start - a.span.start);
  let out = content;
  for (const { span, text } of ordered) {
    out = out.slice(0, span.start) + text + out.slice(span.end);
  }
  return out;
}

/** New wiki target text for a file now at `to`: the bare name when it resolves
 * uniquely (Obsidian's shortest-form convention), else the full path. An
 * explicitly written extension (`[[note.txt]]`, `[[note.md]]`) is preserved;
 * `.md` stays implied otherwise. */
function wikiTargetText(
  to: string,
  from: string,
  postResolver: TargetResolver,
  othersResolver: TargetResolver,
  oldRaw: string,
): string {
  const toExt = extnamePath(to).toLowerCase();
  const fromExt = extnamePath(from).toLowerCase();
  const explicitExt = fromExt !== "" && normalizePath(oldRaw).toLowerCase().endsWith(fromExt);
  const dropExt = toExt === ".md" && !explicitExt;
  const name = basenamePath(to);
  const shortName = dropExt ? name.slice(0, -3) : name;
  const unambiguous =
    postResolver.resolveWiki(shortName) === to && othersResolver.resolveWiki(shortName) === null;
  if (unambiguous) return shortName;
  return dropExt ? to.slice(0, -3) : to;
}

/** New md url for a link from `sourcePath` (post-rename location) to
 * `targetPath`. Always writes the real extension; keeps an existing `./`
 * prefix style when the target stays at-or-below the source's directory. */
function mdUrlText(sourcePath: string, targetPath: string, oldRaw: string): string {
  const rel = relativePath(dirnamePath(sourcePath), targetPath);
  const styled = oldRaw.startsWith("./") && !rel.startsWith("../") ? `./${rel}` : rel;
  return encodeMdUrl(styled);
}

/** Percent-encode the characters that would break a bare markdown destination
 * (space, parens, angle brackets, `#`, and `%` itself). */
function encodeMdUrl(url: string): string {
  return url.replace(
    /[%()<> #]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}
