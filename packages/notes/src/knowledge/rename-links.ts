// Only verified target spans are spliced, so aliases, anchors, alts and `<>`
// wrappers survive. The retarget branch keys on the path-only pre-resolver: a
// link reaching the moved doc through one of its aliases still resolves after
// the rename, and rewriting it would replace the author's word vault-wide.

import type { ExtractedLink, Span } from "./link-extract";
import { scanDoc } from "./link-extract";
import { buildResolver, type TargetResolver } from "./link-resolve";
import { basenamePath, dirnamePath, extnamePath, normalizePath, relativePath } from "./vault-path";

// `docs` is keyed by pre-rename path; the result holds changed docs only, keyed by post-rename path
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
  // everything except the renamed file: proves a short name is unambiguous, not merely winning a tie-break
  const othersResolver = buildResolver(postFiles.filter((p) => p !== toPath));
  const movedDirs = dirnamePath(fromPath) !== dirnamePath(toPath);

  const scans = new Map<string, ReturnType<typeof scanDoc>>();
  for (const [docPath, content] of docs) scans.set(docPath, scanDoc(content));
  const aliasEntries: Array<readonly [string, string]> = [];
  for (const [docPath, scan] of scans) {
    const owner = normalizePath(docPath);
    for (const alias of scan.aliases) aliasEntries.push([alias, owner]);
  }
  // alias-shadow detection only; the retarget branch must stay path-only
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
          // the moved doc's own relative urls re-base; elsewhere an md url changes only when the rename shadowed its resolution
          if (
            (path === fromPath && movedDirs) ||
            postResolver.resolveMd(link.target, postDocPath) !== resolved
          ) {
            text = mdUrlText(postDocPath, resolved, raw);
          }
        } else if (postResolver.resolveWiki(link.target) !== resolved) {
          // the renamed file now wins this short name's tie-break; qualify so the link keeps its meaning
          text = qualifiedWikiText(resolved, raw);
        }
      } else if (link.kind === "wiki") {
        // every path tier missed and the link reaches its target only through an alias the new
        // name now captures via a path tier; qualify it back to the alias owner
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

// back-to-front so earlier spans stay valid; spans come from one scan and never overlap
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

// obsidian's shortest-form convention: the bare name when unique, else the full path; a written extension is preserved
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

function qualifiedWikiText(path: string, oldRaw: string): string {
  const ext = extnamePath(path).toLowerCase();
  const explicitExt = ext !== "" && normalizePath(oldRaw).toLowerCase().endsWith(ext);
  return ext === ".md" && !explicitExt ? path.slice(0, -3) : path;
}

// the span sits before any `#anchor` and the body splits at the first pipe, so `|raw`
// is appended (to keep the visible word) only when the link had neither
function aliasShadowText(ownerPath: string, raw: string, link: ExtractedLink): string {
  const qualified = qualifiedWikiText(ownerPath, raw);
  return link.alias === undefined && link.anchor === undefined ? `${qualified}|${raw}` : qualified;
}

function mdUrlText(sourcePath: string, targetPath: string, oldRaw: string): string {
  const rel = relativePath(dirnamePath(sourcePath), targetPath);
  const styled = oldRaw.startsWith("./") && !rel.startsWith("../") ? `./${rel}` : rel;
  return encodeMdUrl(styled);
}

function encodeMdUrl(url: string): string {
  return url.replace(
    /[%()<> #]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}
