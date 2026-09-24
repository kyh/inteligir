// Only verified target spans are spliced, so aliases, anchors, alts and `<>`
// wrappers survive. The retarget branch keys on a pre-resolver of paths and ids,
// never aliases: a link reaching a moved doc through one of its aliases still
// resolves after the move, and rewriting it would replace the author's word
// vault-wide. A `[[Title|uuid]]` link's title is the app's word, not the author's,
// and its uuid decides which note it names, so its title follows that note and
// never the note the title happens to spell.

import { parseWikiBodyRange, serializeWikiBody } from "../markdown/remark-wiki-link";
import { wikiLinkName, wikiLinkPath } from "./doc-file";
import type { ExtractedLink, Span } from "./link-extract";
import { scanDoc } from "./link-extract";
import { buildResolver, wikiNameKeys } from "./link-resolve";
import type { TargetResolver } from "./link-resolve";
import { basenamePath, dirnamePath, extnamePath, normalizePath, relativePath } from "./vault-path";

// the moves, plus what the branches read: the resolvers before (paths and ids), after and
// before-with-aliases, and every post-move file under each lowercased name key
interface MoveContext {
  moves: ReadonlyMap<string, string>;
  preResolver: TargetResolver;
  postResolver: TargetResolver;
  aliasPreResolver: TargetResolver;
  postNameOwners: ReadonlyMap<string, readonly string[]>;
}

// where a linking doc sits before and after; a move that changes its folder re-bases its own
// relative urls
interface DocPlace {
  path: string;
  postPath: string;
  movedDirs: boolean;
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

// the span covers the target alone, so its escapes are decided in the company of the link's own
// anchor and alias, and the parser's range cuts the target back out. null when no body carries
// the target (a bracket in a path): the link stays as written, for Problems to report
const wikiSpanText = (link: ExtractedLink, target: string): string | null => {
  const body = serializeWikiBody({ alias: link.alias, anchor: link.anchor, target });
  const range = body === null ? undefined : parseWikiBodyRange(body).targetRange;
  return body === null || range === undefined ? null : body.slice(range.start, range.end);
};

const writesExtension = (path: string, link: ExtractedLink): boolean => {
  const ext = extnamePath(path).toLowerCase();
  return ext !== "" && normalizePath(link.target).toLowerCase().endsWith(ext);
};

// no file but `to` answers the name after the move: unambiguous, not merely winning a tie-break.
// every file a bare name answers to is filed under that name's key, so the key is the whole set
const answersOnly = (name: string, to: string, ctx: MoveContext): boolean =>
  ctx.postResolver.resolveWiki(name) === to &&
  (ctx.postNameOwners.get(name.toLowerCase()) ?? []).every((path) => path === to);

// obsidian's shortest-form convention: the bare name when unique, else the full path; a written extension is preserved
const wikiTargetText = (
  link: ExtractedLink,
  from: string,
  to: string,
  ctx: MoveContext,
): string | null => {
  const keepExt = writesExtension(from, link);
  const shortName = keepExt ? basenamePath(to) : wikiLinkName(to);
  if (answersOnly(shortName, to, ctx)) {
    return wikiSpanText(link, shortName);
  }
  return wikiSpanText(link, keepExt ? to : wikiLinkPath(to));
};

const qualifiedWikiTarget = (path: string, link: ExtractedLink): string =>
  writesExtension(path, link) ? path : wikiLinkPath(path);

// the span sits before any `#anchor` and the body splits at the last pipe, so the written
// target becomes the alias (to keep the visible word) only when the link had neither
const aliasShadowText = (ownerPath: string, link: ExtractedLink): string | null => {
  const qualified = qualifiedWikiTarget(ownerPath, link);
  return link.alias === undefined && link.anchor === undefined
    ? serializeWikiBody({ alias: link.target, target: qualified })
    : wikiSpanText(link, qualified);
};

// the link's target stays put, but the move may have changed where the link lands
const shadowedText = (
  link: ExtractedLink,
  raw: string,
  doc: DocPlace,
  resolved: string,
  ctx: MoveContext,
): string | null => {
  if (link.kind !== "wiki") {
    // a moved doc's own relative urls re-base; elsewhere an md url changes only when the move shadowed its resolution
    if (doc.movedDirs || ctx.postResolver.resolveMd(link.target, doc.postPath) !== resolved) {
      return mdUrlText(doc.postPath, resolved, raw);
    }
    return null;
  }
  // a uuid link's title may spell another note than its uuid names; only a title that named the
  // link's note is one the move can steal
  const stolen =
    ctx.preResolver.resolveWiki(link.target) === resolved &&
    ctx.postResolver.resolveWiki(link.target) !== resolved;
  if (stolen) {
    // a moved file now wins this short name's tie-break; qualify so the link keeps its meaning
    return wikiSpanText(link, qualifiedWikiTarget(resolved, link));
  }
  return null;
};

// every path tier missed and the link reaches its target only through an alias a moved
// file now captures via a path tier; qualify it back to the alias owner
const aliasShadowedText = (link: ExtractedLink, ctx: MoveContext): string | null => {
  const aliasOwner = ctx.aliasPreResolver.resolveWiki(link.target);
  if (aliasOwner === null) {
    return null;
  }
  const ownerPost = ctx.moves.get(aliasOwner) ?? aliasOwner;
  const postHit = ctx.postResolver.resolveWiki(link.target);
  if (postHit !== null && postHit !== ownerPost) {
    return aliasShadowText(ownerPost, link);
  }
  return null;
};

const relinkText = (
  link: ExtractedLink,
  raw: string,
  doc: DocPlace,
  ctx: MoveContext,
): string | null => {
  const resolved =
    link.kind === "wiki"
      ? ctx.preResolver.resolveWiki(link.target, link.alias)
      : ctx.preResolver.resolveMd(link.target, doc.path);
  if (resolved === null) {
    return link.kind === "wiki" ? aliasShadowedText(link, ctx) : null;
  }
  const movedTo = ctx.moves.get(resolved);
  if (movedTo !== undefined) {
    return link.kind === "wiki"
      ? wikiTargetText(link, resolved, movedTo, ctx)
      : mdUrlText(doc.postPath, movedTo, raw);
  }
  return shadowedText(link, raw, doc, resolved, ctx);
};

// `moves` maps each moved file's pre-move path to its post-move path: one entry for a note, one
// per file under it for a folder. `docs`, `aliasEntries` and `idEntries` are keyed by pre-move
// path; the result holds changed docs only, keyed by post-move path. The aliases and ids are the
// whole vault's, never derived from `docs`: those are the rewrite candidates, and an owner that
// links nowhere is never one.
interface MoveEditsInput {
  docs: ReadonlyMap<string, string>;
  allFiles: Iterable<string>;
  aliasEntries: Iterable<readonly [alias: string, path: string]>;
  idEntries: Iterable<readonly [id: string, path: string]>;
  moves: ReadonlyMap<string, string>;
}

export const computeMoveEdits = ({
  docs,
  allFiles,
  aliasEntries,
  idEntries,
  moves,
}: MoveEditsInput): Map<string, string> => {
  const edits = new Map<string, string>();
  const normalizedMoves = new Map<string, string>();
  for (const [from, to] of moves) {
    const fromPath = normalizePath(from);
    const toPath = normalizePath(to);
    if (fromPath !== toPath && fromPath !== "" && toPath !== "") {
      normalizedMoves.set(fromPath, toPath);
    }
  }
  if (normalizedMoves.size === 0) {
    return edits;
  }

  const files = [...new Set([...allFiles].map(normalizePath))];
  const postFiles = files.map((p) => normalizedMoves.get(p) ?? p);
  const postNameOwners = new Map<string, string[]>();
  for (const path of postFiles) {
    for (const key of wikiNameKeys(path)) {
      const lower = key.toLowerCase();
      const owners = postNameOwners.get(lower);
      if (owners === undefined) {
        postNameOwners.set(lower, [path]);
      } else {
        owners.push(path);
      }
    }
  }

  const ctx: MoveContext = {
    // alias-shadow detection only; the retarget branch must never read aliases
    aliasPreResolver: buildResolver(files, aliasEntries),
    moves: normalizedMoves,
    postNameOwners,
    postResolver: buildResolver(postFiles),
    preResolver: buildResolver(files, [], idEntries),
  };

  for (const [docPath, content] of docs) {
    const path = normalizePath(docPath);
    const postPath = normalizedMoves.get(path) ?? path;
    const doc: DocPlace = {
      movedDirs: dirnamePath(path) !== dirnamePath(postPath),
      path,
      postPath,
    };
    const replacements: { span: Span; text: string }[] = [];

    for (const link of scanDoc(content).links) {
      if (!link.targetSpan) {
        continue;
      }
      const raw = content.slice(link.targetSpan.start, link.targetSpan.end);
      const text = relinkText(link, raw, doc, ctx);
      if (text !== null && text !== raw) {
        replacements.push({ span: link.targetSpan, text });
      }
    }

    if (replacements.length === 0) {
      continue;
    }
    edits.set(postPath, applyReplacements(content, replacements));
  }
  return edits;
};
