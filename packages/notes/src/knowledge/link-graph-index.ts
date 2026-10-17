// Resolution reads only the path set, the docs' `aliases:` and their `id:`, which one live
// resolver files as they move, so re-projecting a known doc under an unchanged namespace
// re-resolves its own links alone; anything moving a path, alias or id re-files every doc's
// links over that resolver, because a new `note.md` can re-point another doc's dangling
// `[[note]]`.

import { LibraryIndex } from "../items/library-index";
import type {
  FileStat,
  ItemPage,
  ItemPaths,
  ItemQuery,
  ItemRow,
  ItemScopes,
  UrlMatches,
} from "../items/library-index";
import type { ExtractedLink } from "./link-extract";
import type { LinkKind } from "./link-kinds";
import { createPathResolver } from "./link-resolve";
import type { PathResolver } from "./link-resolve";
import type { DocProjection, StoredLink } from "./projection";
import { TagIndex } from "./tag-index";
import type { TagCount } from "./tag-index";
import { notesInTagFamily } from "./tag-notes";
import { basenamePath } from "./vault-path";

export interface BacklinkEntry {
  sourcePath: string;
  line: number;
  snippet: string;
  kind: LinkKind;
  embed: boolean;
  alias?: string;
}

export interface ForwardLinkEntry {
  target: string;
  targetPath: string | null;
  line: number;
  snippet: string;
  kind: LinkKind;
  embed: boolean;
  alias?: string;
  anchor?: string;
}

export interface WikiTarget {
  path: string;
  title: string;
  type: "doc" | "asset";
  aliases?: string[];
  pinned?: boolean;
  id?: string;
}

// the alias and id tiers `buildResolver` takes, read off the rows the index answers.
export const resolverEntriesOf = (targets: readonly WikiTarget[]) => {
  const aliasEntries: (readonly [string, string])[] = [];
  const idEntries: (readonly [string, string])[] = [];
  for (const target of targets) {
    for (const alias of target.aliases ?? []) {
      aliasEntries.push([alias, target.path]);
    }
    if (target.id !== undefined) {
      idEntries.push([target.id, target.path]);
    }
  }
  return { aliasEntries, idEntries };
};

interface DocRecord {
  title: string;
  links: StoredLink[];
  aliases: string[];
  pinned: boolean;
  noteId: string | null;
  /** corpus position, kept across re-projections so an incremental re-file lands in the order a from-scratch build emits */
  seq: number;
}

interface ResolvedLink {
  link: StoredLink;
  targetPath: string | null;
}

interface Occurrence {
  sourcePath: string;
  link: StoredLink;
  seq: number;
}

interface ResolvedState {
  forward: Map<string, ResolvedLink[]>;
  backlinks: Map<string, Occurrence[]>;
}

// re-filing is O(docs × out-degree × in-degree) against the fold's O(corpus); 256 is
// the measured crossover for a 20k-doc corpus with a hub every note links to
const MAX_INCREMENTAL_DOCS = 256;

// equal seqs append after each other (the `<=`), matching a from-scratch build's order
const fileOccurrence = (
  backlinks: Map<string, Occurrence[]>,
  target: string,
  occurrence: Occurrence,
): void => {
  const list = backlinks.get(target);
  if (list === undefined) {
    backlinks.set(target, [occurrence]);
    return;
  }
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const at = list[mid];
    if (at !== undefined && at.seq <= occurrence.seq) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  list.splice(low, 0, occurrence);
};

const sameStrings = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, i) => value === b[i]);
};

const byPath = (a: WikiTarget, b: WikiTarget): number => (a.path < b.path ? -1 : 1);

const resolveLinks = (
  resolver: PathResolver,
  sourcePath: string,
  record: DocRecord,
): ResolvedLink[] =>
  record.links.map((link) => ({
    link,
    targetPath:
      link.kind === "wiki"
        ? resolver.resolveWiki(link.target, link.alias)
        : resolver.resolveMd(link.target, sourcePath),
  }));

export class LinkGraphIndex {
  private readonly docs = new Map<string, DocRecord>();
  private readonly others = new Set<string>();
  private readonly tagIndex = new TagIndex();
  private readonly library = new LibraryIndex();
  private resolver = createPathResolver();
  private resolved: ResolvedState | null = null;
  private readonly pendingDocs = new Set<string>();
  private nextSeq = 0;
  // a path was added or removed, or a doc's aliases or id moved, since the last take
  private targetsMoved = false;

  private allocateSeq(): number {
    const seq = this.nextSeq;
    this.nextSeq += 1;
    return seq;
  }

  applyDoc(path: string, projection: DocProjection): void {
    const wasOther = this.others.delete(path);
    const prior = this.docs.get(path);
    this.docs.set(path, {
      aliases: projection.aliases,
      links: projection.links,
      noteId: projection.noteId,
      pinned: projection.pinned,
      seq: prior?.seq ?? this.allocateSeq(),
      title: projection.title,
    });
    this.tagIndex.set(path, projection.tags);
    this.library.applyDoc(path, projection);
    if (
      prior !== undefined &&
      sameStrings(prior.aliases, projection.aliases) &&
      prior.noteId === projection.noteId
    ) {
      if (this.resolved !== null) {
        this.pendingDocs.add(path);
      }
      return;
    }
    if (prior === undefined && !wasOther) {
      this.resolver.addPath(path);
    }
    this.resolver.setAliases(path, projection.aliases);
    this.resolver.setNoteId(path, projection.noteId);
    this.targetsMoved = true;
    this.dropResolution();
  }

  setOther(path: string): void {
    const wasDoc = this.docs.delete(path);
    if (wasDoc) {
      this.tagIndex.remove(path);
      this.resolver.setAliases(path, []);
      this.resolver.setNoteId(path, null);
    }
    const wasOther = this.others.has(path);
    this.others.add(path);
    this.library.setOther(path);
    if (!wasDoc && !wasOther) {
      this.resolver.addPath(path);
    }
    if (!wasOther) {
      this.targetsMoved = true;
    }
    this.dropResolution();
  }

  remove(path: string): void {
    const wasDoc = this.docs.delete(path);
    if (wasDoc) {
      this.tagIndex.remove(path);
      this.resolver.setAliases(path, []);
      this.resolver.setNoteId(path, null);
    }
    const wasOther = this.others.delete(path);
    this.library.remove(path);
    if (wasDoc || wasOther) {
      this.resolver.removePath(path);
      this.targetsMoved = true;
      this.dropResolution();
    }
  }

  clear(): void {
    this.docs.clear();
    this.others.clear();
    this.tagIndex.clear();
    this.library.clear();
    this.resolver = createPathResolver();
    this.targetsMoved = true;
    this.dropResolution();
  }

  // the listing's size and mtime for a file, which the library sorts and sizes by
  setStat(path: string, stat: FileStat | null): void {
    this.library.setStat(path, stat);
  }

  // whether the set of link targets moved since the last take, and resets it: what the server
  // announces as `targets-changed`
  takeTargetsChanged(): boolean {
    const moved = this.targetsMoved;
    this.targetsMoved = false;
    return moved;
  }

  items(q: ItemQuery): ItemPage {
    return this.library.items(q, this.resolveFile, this.tagsOfPath, this.tagFamily);
  }

  itemPaths(q: ItemQuery): ItemPaths {
    return this.library.paths(q, this.tagFamily);
  }

  itemsAt(paths: readonly string[]): ItemRow[] {
    return this.library.itemsAt(paths, this.resolveFile, this.tagsOfPath);
  }

  findByUrl(url: string, limit: number): UrlMatches {
    return this.library.findByUrl(url, limit, this.resolveFile, this.tagsOfPath);
  }

  scopes(extraFolders: readonly string[], hiddenFolders: readonly string[]): ItemScopes {
    return this.library.scopes(extraFolders, hiddenFolders);
  }

  itemStubs(): string[] {
    return this.library.stubs();
  }

  // a link's target when it is a file that is not a doc
  private readonly resolveFile = (link: ExtractedLink, fromPath: string): string | null => {
    const target =
      link.kind === "wiki"
        ? this.resolver.resolveWiki(link.target, link.alias)
        : this.resolver.resolveMd(link.target, fromPath);
    return target !== null && this.others.has(target) ? target : null;
  };

  private readonly tagsOfPath = (path: string): string[] => this.tagIndex.tagsOf(path);

  private readonly tagFamily = (tag: string): ReadonlySet<string> =>
    new Set(notesInTagFamily(this, tag));

  titleOf(path: string): string | null {
    return this.docs.get(path)?.title ?? null;
  }

  resolveWiki(target: string): string | null {
    return this.resolver.resolveWiki(target);
  }

  backlinks(path: string): BacklinkEntry[] {
    const occurrences = this.ensureResolved().backlinks.get(path) ?? [];
    return occurrences.map(({ sourcePath, link }) => {
      const entry: BacklinkEntry = {
        embed: link.embed,
        kind: link.kind,
        line: link.line,
        snippet: link.snippet,
        sourcePath,
      };
      if (link.alias !== undefined) {
        entry.alias = link.alias;
      }
      return entry;
    });
  }

  forwardLinks(path: string): ForwardLinkEntry[] {
    const links = this.ensureResolved().forward.get(path) ?? [];
    return links.map(({ link, targetPath }) => {
      const entry: ForwardLinkEntry = {
        embed: link.embed,
        kind: link.kind,
        line: link.line,
        snippet: link.snippet,
        target: link.target,
        targetPath,
      };
      if (link.alias !== undefined) {
        entry.alias = link.alias;
      }
      if (link.anchor !== undefined) {
        entry.anchor = link.anchor;
      }
      return entry;
    });
  }

  wikiTargets(): WikiTarget[] {
    const docs: WikiTarget[] = [];
    for (const [path, record] of this.docs) {
      const target: WikiTarget = { path, title: record.title, type: "doc" };
      if (record.aliases.length > 0) {
        target.aliases = record.aliases;
      }
      if (record.pinned) {
        target.pinned = true;
      }
      if (record.noteId !== null) {
        target.id = record.noteId;
      }
      docs.push(target);
    }
    const assets = [...this.others].map((path): WikiTarget => ({
      path,
      title: basenamePath(path),
      type: "asset",
    }));
    return [...docs.toSorted(byPath), ...assets.toSorted(byPath)];
  }

  tags(): TagCount[] {
    return this.tagIndex.all();
  }

  tagsOf(path: string): string[] {
    return this.tagIndex.tagsOf(path);
  }

  notesWithTag(tag: string): string[] {
    return this.tagIndex.notesWithTag(tag);
  }

  pathsWithNoteId(id: string): string[] {
    return [...this.docs]
      .filter(([, record]) => record.noteId === id)
      .map(([path]) => path)
      .toSorted();
  }

  // `lastPath` while it still carries the id: a copied file carries its original's and must not
  // take a binding the original holds. else the id tier's own pick; null when no doc carries it.
  pathForNoteId(id: string, lastPath: string): string | null {
    if (this.docs.get(lastPath)?.noteId === id) {
      return lastPath;
    }
    return this.resolver.resolveNoteId(id);
  }

  private dropResolution(): void {
    this.resolved = null;
    this.pendingDocs.clear();
  }

  private ensureResolved(): ResolvedState {
    const current = this.resolved;
    if (current !== null && this.applyPending(current)) {
      return current;
    }
    const forward = new Map<string, ResolvedLink[]>();
    const backlinks: ResolvedState["backlinks"] = new Map();
    for (const [sourcePath, record] of this.docs) {
      const resolvedLinks = resolveLinks(this.resolver, sourcePath, record);
      forward.set(sourcePath, resolvedLinks);
      for (const { link, targetPath } of resolvedLinks) {
        if (targetPath === null) {
          continue;
        }
        const list = backlinks.get(targetPath);
        const occurrence: Occurrence = { link, seq: record.seq, sourcePath };
        if (list) {
          list.push(occurrence);
        } else {
          backlinks.set(targetPath, [occurrence]);
        }
      }
    }
    this.resolved = { backlinks, forward };
    this.pendingDocs.clear();
    return this.resolved;
  }

  // false means rebuild: too many pending, or a doc with no prior forward entry, whose position among the occurrences is unknown
  private applyPending(state: ResolvedState): boolean {
    if (this.pendingDocs.size === 0) {
      return true;
    }
    if (this.pendingDocs.size > MAX_INCREMENTAL_DOCS) {
      return false;
    }
    for (const path of this.pendingDocs) {
      const record = this.docs.get(path);
      const stale = state.forward.get(path);
      if (record === undefined || stale === undefined) {
        return false;
      }
      const touched = new Set<string>();
      for (const { targetPath } of stale) {
        if (targetPath !== null) {
          touched.add(targetPath);
        }
      }
      for (const target of touched) {
        const kept = state.backlinks.get(target)?.filter((o) => o.sourcePath !== path);
        if (kept === undefined) {
          continue;
        }
        if (kept.length === 0) {
          state.backlinks.delete(target);
        } else {
          state.backlinks.set(target, kept);
        }
      }
      const links = resolveLinks(this.resolver, path, record);
      state.forward.set(path, links);
      for (const { link, targetPath } of links) {
        if (targetPath === null) {
          continue;
        }
        fileOccurrence(state.backlinks, targetPath, { link, seq: record.seq, sourcePath: path });
      }
    }
    this.pendingDocs.clear();
    return true;
  }
}
