// ---------------------------------------------------------------------------
// Rename-rewrite: when a vault file moves `from` → `to`, compute the minimal
// byte-surgical edits that keep every link pointing at it. Pure — the host
// applies the returned contents through the vault's own writes; the
// fixture bridge applies them to its in-memory Map.
//
// Only the recorded target span of each link changes (extraction emits spans
// exclusively after byte verification): aliases (`[[old|alias]]`), anchors
// (`[[old#sec]]`), image alts (`![alt](..)`), body padding, and `<>` url
// wrappers all survive verbatim. Links inside fences/code spans were never
// extracted, so they are never touched. Assets rename like docs: `from` may
// be any vault file, and `![](img.png)` / `![[img.png]]` references rewrite
// exactly like `[[note]]` ones. Three link populations are rewritten:
//   1. links in ANY doc that resolve to `from` (including self-links inside
//      the moved doc) — retargeted at `to`;
//   2. relative md/image urls FROM the moved doc to other files — re-based
//      when the move changed directories (wiki links are location-independent);
//   3. links in ANY doc whose target the rename SHADOWS (`[[note]]` reached
//      a/note.md; the file just renamed to note.md now wins the tie-break) —
//      qualified so they keep meaning what they meant. This includes links
//      that resolved only via a frontmatter ALIAS the new name now steals
//      (path tiers beat alias tiers): those are qualified back to the alias
//      owner's path, keeping the visible word as the display alias.
//
// Resolver roles are deliberately split: the RETARGET branch keys on the
// PATH-ONLY pre-resolver — a link that reaches the moved doc via one of its
// aliases must NOT be rewritten (the alias travels with the file's
// frontmatter and still resolves post-rename); rewriting it would replace
// the author's chosen word vault-wide. The alias-aware pre-resolver serves
// ONLY alias-shadow detection. The about-to-be-recorded old-title alias is
// counted NOWHERE here — rewrites stay canonical; that alias is the fallback
// for what surgery misses, never a reason to skip it.
// ---------------------------------------------------------------------------

import type { ExtractedLink, Span } from "./link-extract";
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

  // One scan per doc, hoisted: the loop needs each doc's links, and the
  // alias-aware pre-resolver needs EVERY doc's aliases before the loop runs.
  const scans = new Map<string, ReturnType<typeof scanDoc>>();
  for (const [docPath, content] of docs) scans.set(docPath, scanDoc(content));
  const aliasEntries: Array<readonly [string, string]> = [];
  for (const [docPath, scan] of scans) {
    const owner = normalizePath(docPath);
    for (const alias of scan.aliases) aliasEntries.push([alias, owner]);
  }
  // Alias-shadow detection ONLY (see header) — never the retarget branch.
  const aliasPreResolver = buildResolver(files, aliasEntries);

  for (const [docPath, content] of docs) {
    const path = normalizePath(docPath);
    const postDocPath = path === fromPath ? toPath : path;
    const replacements: Array<{ span: Span; text: string }> = [];

    for (const link of scans.get(docPath)?.links ?? []) {
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
      } else if (resolved !== null) {
        if (link.kind !== "wiki") {
          // The moved doc's own outgoing relative md/image urls re-base to its
          // new directory; elsewhere an md url only changes when the rename
          // shadowed its resolution (a case-insensitive tie now lost).
          if (
            (path === fromPath && movedDirs) ||
            postResolver.resolveMd(link.target, postDocPath) !== resolved
          ) {
            text = mdUrlText(postDocPath, resolved, raw);
          }
        } else if (postResolver.resolveWiki(link.target) !== resolved) {
          // The renamed file now wins this short name's tie-break (`[[note]]`
          // used to reach a/note.md; the new root note.md shadows it) —
          // qualify the target so the link keeps meaning what it meant.
          text = qualifiedWikiText(resolved, raw);
        }
      } else if (link.kind === "wiki") {
        // Alias-shadow case: every path tier missed (resolved === null), the
        // link reaches its target only via an alias, and the renamed file's
        // new name captures it through a PATH tier post-rename — path beats
        // alias, so the link would silently change meaning. Qualify it back
        // to the alias owner (remapped when the owner IS the moved doc; if
        // the new path hit and the owner agree, nothing changed — e.g. the
        // doc was renamed TO its own alias).
        const aliasOwner = aliasPreResolver.resolveWiki(link.target);
        if (aliasOwner !== null) {
          const ownerPost = aliasOwner === fromPath ? toPath : aliasOwner;
          const postHit = postResolver.resolveWiki(link.target);
          if (postHit !== null && postHit !== ownerPost) {
            text = aliasShadowText(ownerPost, raw, link);
          }
        }
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

/** Fully qualified wiki target for the (un-renamed) file at `path` — the
 * anti-shadow rewrite. Tier-1 exact-path resolution makes it unambiguous;
 * the raw text's extension style is preserved (`.md` stays implied unless
 * written out). */
function qualifiedWikiText(path: string, oldRaw: string): string {
  const ext = extnamePath(path).toLowerCase();
  const explicitExt = ext !== "" && normalizePath(oldRaw).toLowerCase().endsWith(ext);
  return ext === ".md" && !explicitExt ? path.slice(0, -3) : path;
}

/** Qualified target for a link whose ALIAS the rename stole. When the link
 * had neither an explicit `|alias` nor a `#anchor`, the raw alias text is
 * appended as the display alias so the visible word survives — `[[Bar]]` →
 * `[[owner|Bar]]`. Otherwise only the target is qualified: the targetSpan
 * splice sits BEFORE any `#anchor`, and the wiki body splits at the FIRST
 * pipe, so appending `|raw` there would corrupt the existing display text or
 * swallow the anchor into it. */
function aliasShadowText(ownerPath: string, raw: string, link: ExtractedLink): string {
  const qualified = qualifiedWikiText(ownerPath, raw);
  return link.alias === undefined && link.anchor === undefined ? `${qualified}|${raw}` : qualified;
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
