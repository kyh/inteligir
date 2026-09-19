// Only verified target spans are spliced, so aliases, anchors, alts and `<>`
// wrappers survive. The retarget branch keys on the path-only pre-resolver: a
// link reaching the moved doc through one of its aliases still resolves after
// the rename, and rewriting it would replace the author's word vault-wide.

import type { ExtractedLink, Span } from "./link-extract";
import { scanDoc } from "./link-extract";
import { buildResolver } from "./link-resolve";
import type { TargetResolver } from "./link-resolve";
import { basenamePath, dirnamePath, extnamePath, normalizePath, relativePath } from "./vault-path";

// the rename, plus the resolvers the branches read: before, after, after-without-the-renamed-
// file (to prove a short name is unambiguous) and before-with-aliases
interface RenameContext {
  fromPath: string;
  toPath: string;
  movedDirs: boolean;
  preResolver: TargetResolver;
  postResolver: TargetResolver;
  othersResolver: TargetResolver;
  aliasPreResolver: TargetResolver;
}

// back-to-front so earlier spans stay valid; spans come from one scan and never overlap
const applyReplacements = (
  content: string,
  replacements: { span: Span; text: string }[],
): string => {
  const ordered = replacements.toSorted((a, b) => b.span.start - a.span.start);
  let out = content;
  for (const { span, text } of ordered) {
    out = out.slice(0, span.start) + text + out.slice(span.end);
  }
  return out;
};

const encodeMdUrl = (url: string): string =>
  url.replaceAll(/[%()<> #]/gu, (c) => {
    const code = c.codePointAt(0);
    return code === undefined ? c : `%${code.toString(16).toUpperCase().padStart(2, "0")}`;
  });

const mdUrlText = (sourcePath: string, targetPath: string, oldRaw: string): string => {
  const rel = relativePath(dirnamePath(sourcePath), targetPath);
  const styled = oldRaw.startsWith("./") && !rel.startsWith("../") ? `./${rel}` : rel;
  return encodeMdUrl(styled);
};

// obsidian's shortest-form convention: the bare name when unique, else the full path; a written extension is preserved
const wikiTargetText = (
  to: string,
  from: string,
  postResolver: TargetResolver,
  othersResolver: TargetResolver,
  oldRaw: string,
): string => {
  const toExt = extnamePath(to).toLowerCase();
  const fromExt = extnamePath(from).toLowerCase();
  const explicitExt = fromExt !== "" && normalizePath(oldRaw).toLowerCase().endsWith(fromExt);
  const dropExt = toExt === ".md" && !explicitExt;
  const name = basenamePath(to);
  const shortName = dropExt ? name.slice(0, -3) : name;
  const unambiguous =
    postResolver.resolveWiki(shortName) === to && othersResolver.resolveWiki(shortName) === null;
  if (unambiguous) {
    return shortName;
  }
  return dropExt ? to.slice(0, -3) : to;
};

const qualifiedWikiText = (path: string, oldRaw: string): string => {
  const ext = extnamePath(path).toLowerCase();
  const explicitExt = ext !== "" && normalizePath(oldRaw).toLowerCase().endsWith(ext);
  return ext === ".md" && !explicitExt ? path.slice(0, -3) : path;
};

// the span sits before any `#anchor` and the body splits at the first pipe, so `|raw`
// is appended (to keep the visible word) only when the link had neither
const aliasShadowText = (ownerPath: string, raw: string, link: ExtractedLink): string => {
  const qualified = qualifiedWikiText(ownerPath, raw);
  return link.alias === undefined && link.anchor === undefined ? `${qualified}|${raw}` : qualified;
};

// the link still resolves after the rename, but the rename moved where it lands
const shadowedText = (
  link: ExtractedLink,
  raw: string,
  docPath: string,
  postDocPath: string,
  resolved: string,
  ctx: RenameContext,
): string | null => {
  if (link.kind !== "wiki") {
    // the moved doc's own relative urls re-base; elsewhere an md url changes only when the rename shadowed its resolution
    if (
      (docPath === ctx.fromPath && ctx.movedDirs) ||
      ctx.postResolver.resolveMd(link.target, postDocPath) !== resolved
    ) {
      return mdUrlText(postDocPath, resolved, raw);
    }
    return null;
  }
  if (ctx.postResolver.resolveWiki(link.target) !== resolved) {
    // the renamed file now wins this short name's tie-break; qualify so the link keeps its meaning
    return qualifiedWikiText(resolved, raw);
  }
  return null;
};

// every path tier missed and the link reaches its target only through an alias the new
// name now captures via a path tier; qualify it back to the alias owner
const aliasShadowedText = (link: ExtractedLink, raw: string, ctx: RenameContext): string | null => {
  const aliasOwner = ctx.aliasPreResolver.resolveWiki(link.target);
  if (aliasOwner === null) {
    return null;
  }
  const ownerPost = aliasOwner === ctx.fromPath ? ctx.toPath : aliasOwner;
  const postHit = ctx.postResolver.resolveWiki(link.target);
  if (postHit !== null && postHit !== ownerPost) {
    return aliasShadowText(ownerPost, raw, link);
  }
  return null;
};

const relinkText = (
  link: ExtractedLink,
  raw: string,
  docPath: string,
  postDocPath: string,
  ctx: RenameContext,
): string | null => {
  const resolved =
    link.kind === "wiki"
      ? ctx.preResolver.resolveWiki(link.target)
      : ctx.preResolver.resolveMd(link.target, docPath);
  if (resolved === ctx.fromPath) {
    return link.kind === "wiki"
      ? wikiTargetText(ctx.toPath, ctx.fromPath, ctx.postResolver, ctx.othersResolver, raw)
      : mdUrlText(postDocPath, ctx.toPath, raw);
  }
  if (resolved !== null) {
    return shadowedText(link, raw, docPath, postDocPath, resolved, ctx);
  }
  if (link.kind === "wiki") {
    return aliasShadowedText(link, raw, ctx);
  }
  return null;
};

// `docs` is keyed by pre-rename path; the result holds changed docs only, keyed by post-rename path
export const computeRenameEdits = (
  docs: ReadonlyMap<string, string>,
  allFiles: Iterable<string>,
  from: string,
  to: string,
): Map<string, string> => {
  const edits = new Map<string, string>();
  const fromPath = normalizePath(from);
  const toPath = normalizePath(to);
  if (fromPath === toPath || fromPath === "" || toPath === "") {
    return edits;
  }

  const files = [...new Set([...allFiles].map(normalizePath))];
  const postFiles = files.map((p) => (p === fromPath ? toPath : p));

  const scans = new Map<string, ReturnType<typeof scanDoc>>();
  for (const [docPath, content] of docs) {
    scans.set(docPath, scanDoc(content));
  }
  const aliasEntries: (readonly [string, string])[] = [];
  for (const [docPath, scan] of scans) {
    const owner = normalizePath(docPath);
    for (const alias of scan.aliases) {
      aliasEntries.push([alias, owner]);
    }
  }

  const ctx: RenameContext = {
    // alias-shadow detection only; the retarget branch must stay path-only
    aliasPreResolver: buildResolver(files, aliasEntries),
    fromPath,
    movedDirs: dirnamePath(fromPath) !== dirnamePath(toPath),
    // everything except the renamed file: proves a short name is unambiguous, not merely winning a tie-break
    othersResolver: buildResolver(postFiles.filter((p) => p !== toPath)),
    postResolver: buildResolver(postFiles),
    preResolver: buildResolver(files),
    toPath,
  };

  for (const [docPath, content] of docs) {
    const path = normalizePath(docPath);
    const postDocPath = path === fromPath ? toPath : path;
    const replacements: { span: Span; text: string }[] = [];

    for (const link of scans.get(docPath)?.links ?? []) {
      if (!link.targetSpan) {
        continue;
      }
      const raw = content.slice(link.targetSpan.start, link.targetSpan.end);
      const text = relinkText(link, raw, path, postDocPath, ctx);
      if (text !== null && text !== raw) {
        replacements.push({ span: link.targetSpan, text });
      }
    }

    if (replacements.length === 0) {
      continue;
    }
    edits.set(postDocPath, applyReplacements(content, replacements));
  }
  return edits;
};
