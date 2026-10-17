// The library listing: every item the grid shows, answered from memory beside the tags. Owned by
// LinkGraphIndex, which feeds it every doc and other it files and forwards the queries with its
// live resolver and tag index. A page costs its own rows; only a filter walks the members.

import { docStem, isVaultMetadataPath } from "../knowledge/doc-file";
import type { ExtractedLink } from "../knowledge/link-extract";
import type { DocProjection } from "../knowledge/projection";
import {
  basenamePath,
  dirnamePath,
  extnamePath,
  joinPath,
  normalizePath,
  vaultCollisionKey,
} from "../knowledge/vault-path";
import { isItemStub } from "./item-frontmatter";
import type { ItemFacts } from "./item-frontmatter";
import { itemFilesOf } from "./item-files";
import {
  COVERS_DIR,
  fileKindOf,
  ITEM_KINDS,
  LIBRARY_RULES_PATH,
  PAGES_DIR,
  UNSORTED_FOLDER,
} from "./item-kind";
import type { FileKind, ItemKind } from "./item-kind";
import { formatItemTime } from "./item-time";
import { siteMatches, urlKey } from "./item-url";

export type ItemSort = "saved" | "modified" | "title" | "relevance";

export interface ItemQuery {
  kinds?: readonly ItemKind[];
  tag?: string;
  untagged: boolean;
  folder?: string;
  subfolders: boolean;
  site?: string;
  sinceMs?: number;
  // path → rank from a search (lower is better); only these paths answer
  within?: ReadonlyMap<string, number>;
  sort: ItemSort;
  limit: number;
  offset: number;
}

// exactly the wire's ItemRowWire, which the contract's engine-mirror test holds
export interface ItemRow {
  // the frontmatter id a doc carries, which follows it through a rename; null for a bare file
  id: string | null;
  author: string | null;
  // a media file no doc embeds, listed as its own card
  bare: boolean;
  copy: string | null;
  cover: string | null;
  description: string | null;
  fetchError: string | null;
  fetched: string | null;
  file: string | null;
  fileBytes: number | null;
  folder: string;
  host: string | null;
  kind: ItemKind;
  modifiedMs: number | null;
  path: string;
  pending: boolean;
  pinned: boolean;
  preview: string;
  published: string | null;
  saved: string | null;
  site: string | null;
  tags: string[];
  title: string;
  url: string | null;
}

export interface ItemPage {
  items: ItemRow[];
  total: number;
  // the filtered set's count per kind, the query's own kinds ignored
  kindCounts: Record<ItemKind, number>;
}

export interface UrlMatches {
  key: string | null;
  items: ItemRow[];
}

export interface LibraryFolderCount {
  path: string;
  // items in it and below
  items: number;
}

export interface ItemScopes {
  total: number;
  unsorted: number;
  untagged: number;
  folders: LibraryFolderCount[];
}

export interface FileStat {
  size: number;
  mtimeMs: number;
}

// a link's target when it names a file that is not a doc, else null
export type Resolve = (link: ExtractedLink, fromPath: string) => string | null;

type TagsOf = (path: string) => string[];
type TagFamily = (tag: string) => ReadonlySet<string>;

interface DocEntry {
  kind: "doc";
  noteId: string | null;
  facts: ItemFacts;
  preview: string;
  pinned: boolean;
  tagged: boolean;
  links: readonly ExtractedLink[];
  // the reference keys its links count
  refs: ReadonlySet<string>;
}

interface OtherEntry {
  kind: "other";
  // image, pdf, video or audio: the files a card can stand for
  media: Exclude<FileKind, "file"> | null;
}

type Entry = DocEntry | OtherEntry;

const isHidden = (path: string): boolean =>
  path.toLowerCase() === LIBRARY_RULES_PATH.toLowerCase() ||
  isVaultMetadataPath(path) ||
  path.startsWith(`${COVERS_DIR}/`) ||
  path.startsWith(`${PAGES_DIR}/`);

export const mediaKindOf = (path: string): Exclude<FileKind, "file"> | null => {
  const kind = fileKindOf(path);
  return kind === null || kind === "file" ? null : kind;
};

// a file is named by its path (an md link, from the doc's folder or the root) or by its basename
// (a wiki link): the two key spaces never meet
const pathRef = (path: string): string => `p:${vaultCollisionKey(path)}`;
const nameRef = (name: string): string => `n:${vaultCollisionKey(basenamePath(name))}`;

// the keys the doc at `path` names files by; a media file is bare while no doc's key is one of
// its own two (`fileRefsOf`), which the phone's listing asks too
export const refsOf = (path: string, links: readonly ExtractedLink[]): Set<string> => {
  const refs = new Set<string>();
  for (const link of links) {
    if (link.kind === "wiki") {
      refs.add(nameRef(normalizePath(link.target)));
      continue;
    }
    refs.add(pathRef(joinPath(dirnamePath(path), link.target)));
    refs.add(pathRef(normalizePath(link.target)));
  }
  return refs;
};

export const fileRefsOf = (path: string): [string, string] => [pathRef(path), nameRef(path)];

const emptyKindCounts = (): Record<ItemKind, number> => ({
  audio: 0,
  file: 0,
  image: 0,
  link: 0,
  note: 0,
  pdf: 0,
  video: 0,
});

const titleOf = (path: string, entry: Entry): string => {
  if (entry.kind === "doc") {
    return docStem(path);
  }
  const name = basenamePath(path);
  return name.slice(0, name.length - extnamePath(name).length);
};

const inFolder = (path: string, folder: string | undefined, subfolders: boolean): boolean => {
  if (folder === undefined) {
    return true;
  }
  const at = dirnamePath(path);
  if (folder === "") {
    return subfolders || at === "";
  }
  return at === folder || (subfolders && at.startsWith(`${folder}/`));
};

const compareText = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
};

// a folder tree in rail order: parents before children, names in order within a parent
const compareFolders = (a: string, b: string): number => {
  const left = a.split("/");
  const right = b.split("/");
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    const l = left[i] ?? "";
    const r = right[i] ?? "";
    const order = compareText(l.toLowerCase(), r.toLowerCase()) || compareText(l, r);
    if (order !== 0) {
      return order;
    }
  }
  return left.length - right.length;
};

const ancestorsOf = (folder: string): string[] => {
  const out: string[] = [];
  for (let at = folder; at !== ""; at = dirnamePath(at)) {
    out.push(at);
  }
  return out;
};

type CachedSort = Exclude<ItemSort, "relevance">;

const kindOfEntry = (entry: Entry): ItemKind => {
  if (entry.kind === "doc") {
    return entry.facts.kind;
  }
  return entry.media ?? "file";
};

// only the kinds and the order: every member is a candidate, and the totals are kept
const isNarrowed = (q: ItemQuery): boolean =>
  q.within !== undefined ||
  q.folder !== undefined ||
  q.tag !== undefined ||
  q.untagged ||
  q.site !== undefined ||
  q.sinceMs !== undefined;

export interface ItemPaths {
  paths: string[];
  total: number;
}

interface Selection {
  matched: string[];
  total: number;
  kindCounts: Record<ItemKind, number>;
}

export class LibraryIndex {
  private readonly entries = new Map<string, Entry>();
  private readonly stats = new Map<string, FileStat>();
  private readonly refCounts = new Map<string, number>();
  // the reference keys of every media file a card could stand for, so a link that starts or stops
  // naming one re-decides its bareness
  private readonly mediaRefs = new Map<string, Set<string>>();
  private readonly byUrlKey = new Map<string, Set<string>>();
  private readonly sorted = new Map<CachedSort, string[]>();
  private kindTotals: Record<ItemKind, number> | null = null;

  applyDoc(path: string, projection: DocProjection): void {
    const prior = this.entries.get(path);
    const refs = refsOf(path, projection.links);
    const entry: DocEntry = {
      facts: projection.item,
      kind: "doc",
      links: projection.links,
      noteId: projection.noteId,
      pinned: projection.pinned,
      preview: projection.preview,
      refs,
      tagged: projection.tags.length > 0,
    };
    if (prior?.kind === "doc") {
      // the diff alone: a re-saved doc keeps naming the same files, which re-decides nothing
      this.fileRefs(new Set([...prior.refs].filter((key) => !refs.has(key))), -1);
      this.fileRefs(new Set([...refs].filter((key) => !prior.refs.has(key))), 1);
      this.unfileUrl(path, prior.facts.urlKey);
    } else {
      this.unfile(path, prior);
      this.fileRefs(refs, 1);
    }
    this.entries.set(path, entry);
    this.fileUrl(path, entry.facts.urlKey);
    if (isHidden(path)) {
      return;
    }
    if (prior?.kind !== "doc" || prior.pinned !== entry.pinned) {
      this.dirtyMembers();
      return;
    }
    if (prior.facts.kind !== entry.facts.kind) {
      this.kindTotals = null;
    }
    if (prior.facts.savedMs !== entry.facts.savedMs) {
      this.sorted.delete("saved");
    }
  }

  setOther(path: string): void {
    const prior = this.entries.get(path);
    this.unfile(path, prior);
    const media = isHidden(path) ? null : mediaKindOf(path);
    this.entries.set(path, { kind: "other", media });
    if (media !== null) {
      for (const key of [pathRef(path), nameRef(path)]) {
        const owners = this.mediaRefs.get(key) ?? new Set();
        owners.add(path);
        this.mediaRefs.set(key, owners);
      }
    }
    if (prior?.kind !== "other" && !isHidden(path)) {
      this.dirtyMembers();
    }
  }

  remove(path: string): void {
    const prior = this.entries.get(path);
    this.stats.delete(path);
    if (prior === undefined) {
      return;
    }
    this.unfile(path, prior);
    this.entries.delete(path);
    if (!isHidden(path)) {
      this.dirtyMembers();
    }
  }

  clear(): void {
    this.entries.clear();
    this.stats.clear();
    this.refCounts.clear();
    this.mediaRefs.clear();
    this.byUrlKey.clear();
    this.dirtyMembers();
  }

  setStat(path: string, stat: FileStat | null): void {
    const prior = this.stats.get(path);
    if (prior?.size === stat?.size && prior?.mtimeMs === stat?.mtimeMs) {
      return;
    }
    if (stat === null) {
      this.stats.delete(path);
    } else {
      this.stats.set(path, stat);
    }
    if (prior?.mtimeMs !== stat?.mtimeMs) {
      this.sorted.delete("modified");
      const entry = this.entries.get(path);
      if (entry?.kind !== "doc" || entry.facts.savedMs === null) {
        this.sorted.delete("saved");
      }
    }
  }

  items(q: ItemQuery, resolve: Resolve, tagsOf: TagsOf, family: TagFamily): ItemPage {
    const { kindCounts, matched, total } = this.select(q, family, q.offset + q.limit);
    const page = matched.slice(q.offset, q.offset + q.limit);
    return { items: this.rowsOf(page, resolve, tagsOf), kindCounts, total };
  }

  itemsAt(paths: readonly string[], resolve: Resolve, tagsOf: TagsOf): ItemRow[] {
    return this.rowsOf(
      paths.filter((path) => this.isMember(path)),
      resolve,
      tagsOf,
    );
  }

  paths(q: ItemQuery, family: TagFamily): ItemPaths {
    const { matched, total } = this.select(q, family, q.offset + q.limit);
    return { paths: matched.slice(q.offset, q.offset + q.limit), total };
  }

  // non-stub items first, then the earliest saved
  findByUrl(url: string, limit: number, resolve: Resolve, tagsOf: TagsOf): UrlMatches {
    const key = urlKey(url);
    if (key === null) {
      return { items: [], key };
    }
    const found = [...(this.byUrlKey.get(key) ?? [])].filter((path) => this.isMember(path));
    const order = (path: string): [number, number] => {
      const entry = this.entries.get(path);
      const facts = entry?.kind === "doc" ? entry.facts : null;
      return [
        facts !== null && isItemStub(facts) ? 1 : 0,
        facts?.savedMs ?? Number.POSITIVE_INFINITY,
      ];
    };
    const ranked = found.toSorted((a, b) => {
      const [stubA, savedA] = order(a);
      const [stubB, savedB] = order(b);
      return stubA - stubB || savedA - savedB || compareText(a, b);
    });
    return { items: this.rowsOf(ranked.slice(0, limit), resolve, tagsOf), key };
  }

  // `extraFolders`: the vault's directories, listed even when empty; a hidden folder hides its
  // whole subtree, as a dot-folder always does
  scopes(extraFolders: readonly string[], hiddenFolders: readonly string[]): ItemScopes {
    const isHiddenFolder = (folder: string): boolean =>
      isVaultMetadataPath(folder) ||
      hiddenFolders.some((hidden) => folder === hidden || folder.startsWith(`${hidden}/`));
    const counts = new Map<string, number>();
    let total = 0;
    let unsorted = 0;
    let untagged = 0;
    for (const [path, entry] of this.entries) {
      if (!this.isMemberEntry(path, entry)) {
        continue;
      }
      total += 1;
      if (entry.kind === "other" || !entry.tagged) {
        untagged += 1;
      }
      const folder = dirnamePath(path);
      if (folder === UNSORTED_FOLDER || folder.startsWith(`${UNSORTED_FOLDER}/`)) {
        unsorted += 1;
      }
      for (const at of ancestorsOf(folder)) {
        counts.set(at, (counts.get(at) ?? 0) + 1);
      }
    }
    const listed = new Set(counts.keys());
    for (const folder of extraFolders) {
      for (const at of ancestorsOf(normalizePath(folder))) {
        listed.add(at);
      }
    }
    const folders = [...listed]
      .filter((folder) => !isHiddenFolder(folder))
      .toSorted(compareFolders)
      .map((path) => ({ items: counts.get(path) ?? 0, path }));
    return { folders, total, unsorted, untagged };
  }

  // the stubs a fill may take, the earliest saved first
  stubs(): string[] {
    const found: { path: string; savedMs: number }[] = [];
    for (const [path, entry] of this.entries) {
      if (entry.kind === "doc" && !isHidden(path) && isItemStub(entry.facts)) {
        found.push({ path, savedMs: entry.facts.savedMs ?? 0 });
      }
    }
    return found
      .toSorted((a, b) => a.savedMs - b.savedMs || compareText(a.path, b.path))
      .map(({ path }) => path);
  }

  private isMember(path: string): boolean {
    const entry = this.entries.get(path);
    return entry !== undefined && this.isMemberEntry(path, entry);
  }

  private isMemberEntry(path: string, entry: Entry): boolean {
    if (entry.kind === "doc") {
      return !isHidden(path);
    }
    return (
      entry.media !== null && fileRefsOf(path).every((key) => (this.refCounts.get(key) ?? 0) === 0)
    );
  }

  private unfile(path: string, prior: Entry | undefined): void {
    if (prior?.kind === "doc") {
      this.fileRefs(prior.refs, -1);
      this.unfileUrl(path, prior.facts.urlKey);
    } else if (prior?.kind === "other" && prior.media !== null) {
      for (const key of [pathRef(path), nameRef(path)]) {
        const owners = this.mediaRefs.get(key);
        owners?.delete(path);
        if (owners?.size === 0) {
          this.mediaRefs.delete(key);
        }
      }
    }
  }

  // a key whose count crosses zero re-decides the bareness of the media files it names
  private fileRefs(refs: ReadonlySet<string>, delta: 1 | -1): void {
    for (const key of refs) {
      const before = this.refCounts.get(key) ?? 0;
      const after = before + delta;
      if (after <= 0) {
        this.refCounts.delete(key);
      } else {
        this.refCounts.set(key, after);
      }
      if ((before === 0) !== after <= 0 && this.mediaRefs.has(key)) {
        this.dirtyMembers();
      }
    }
  }

  private fileUrl(path: string, key: string | null): void {
    if (key === null) {
      return;
    }
    const owners = this.byUrlKey.get(key) ?? new Set();
    owners.add(path);
    this.byUrlKey.set(key, owners);
  }

  private unfileUrl(path: string, key: string | null): void {
    if (key === null) {
      return;
    }
    const owners = this.byUrlKey.get(key);
    owners?.delete(path);
    if (owners?.size === 0) {
      this.byUrlKey.delete(key);
    }
  }

  private dirtyMembers(): void {
    this.sorted.clear();
    this.kindTotals = null;
  }

  private savedKeyOf(path: string, entry: Entry | undefined): number {
    const saved = entry?.kind === "doc" ? entry.facts.savedMs : null;
    return saved ?? this.stats.get(path)?.mtimeMs ?? 0;
  }

  private membersSorted(sort: CachedSort): string[] {
    const cached = this.sorted.get(sort);
    if (cached !== undefined) {
      return cached;
    }
    const rows: { path: string; pinned: number; key: number; text: string }[] = [];
    for (const [path, entry] of this.entries) {
      if (!this.isMemberEntry(path, entry)) {
        continue;
      }
      const pinned = entry.kind === "doc" && entry.pinned ? 0 : 1;
      if (sort === "title") {
        rows.push({ key: 0, path, pinned, text: titleOf(path, entry).toLowerCase() });
      } else {
        const key =
          sort === "saved"
            ? this.savedKeyOf(path, entry)
            : (this.stats.get(path)?.mtimeMs ?? Number.NEGATIVE_INFINITY);
        rows.push({ key, path, pinned, text: "" });
      }
    }
    const order = rows
      .toSorted(
        (a, b) =>
          a.pinned - b.pinned ||
          (sort === "title" ? compareText(a.text, b.text) : b.key - a.key) ||
          compareText(a.path, b.path),
      )
      .map(({ path }) => path);
    this.sorted.set(sort, order);
    return order;
  }

  private totalsByKind(): Record<ItemKind, number> {
    if (this.kindTotals !== null) {
      return this.kindTotals;
    }
    const totals = emptyKindCounts();
    for (const [path, entry] of this.entries) {
      if (this.isMemberEntry(path, entry)) {
        totals[kindOfEntry(entry)] += 1;
      }
    }
    this.kindTotals = totals;
    return totals;
  }

  // a ranked search's hits in rank order, pinned first, then the saved order between equals
  private relevanceOrder(within: ReadonlyMap<string, number>): string[] {
    return [...within.keys()]
      .filter((path) => this.isMember(path))
      .toSorted((a, b) => {
        const entryA = this.entries.get(a);
        const entryB = this.entries.get(b);
        const pinnedA = entryA?.kind === "doc" && entryA.pinned ? 0 : 1;
        const pinnedB = entryB?.kind === "doc" && entryB.pinned ? 0 : 1;
        return (
          pinnedA - pinnedB ||
          (within.get(a) ?? 0) - (within.get(b) ?? 0) ||
          this.savedKeyOf(b, entryB) - this.savedKeyOf(a, entryA) ||
          compareText(a, b)
        );
      });
  }

  // the matched paths in order (whole, or at least `needed` of them when nothing but the kinds
  // narrows), their count and the count per kind
  private select(q: ItemQuery, family: TagFamily, needed: number): Selection {
    const kinds = q.kinds === undefined ? null : new Set(q.kinds);
    const order =
      q.sort === "relevance" && q.within !== undefined
        ? this.relevanceOrder(q.within)
        : this.membersSorted(q.sort === "relevance" ? "saved" : q.sort);
    return isNarrowed(q)
      ? this.selectNarrowed(order, q, kinds, family)
      : this.selectByKind(order, kinds, needed);
  }

  // the kept totals answer the counts, and the page stops the walk
  private selectByKind(
    order: readonly string[],
    kinds: ReadonlySet<ItemKind> | null,
    needed: number,
  ): Selection {
    const kindCounts = { ...this.totalsByKind() };
    const total = ITEM_KINDS.reduce(
      (sum, kind) => sum + (kinds === null || kinds.has(kind) ? kindCounts[kind] : 0),
      0,
    );
    const matched: string[] = [];
    for (const path of order) {
      if (matched.length >= needed) {
        break;
      }
      const entry = this.entries.get(path);
      if (entry !== undefined && (kinds === null || kinds.has(kindOfEntry(entry)))) {
        matched.push(path);
      }
    }
    return { kindCounts, matched, total };
  }

  private selectNarrowed(
    order: readonly string[],
    q: ItemQuery,
    kinds: ReadonlySet<ItemKind> | null,
    family: TagFamily,
  ): Selection {
    const members = q.tag === undefined ? null : family(q.tag);
    const kindCounts = emptyKindCounts();
    const matched: string[] = [];
    for (const path of order) {
      const entry = this.entries.get(path);
      if (entry === undefined || !this.passes(path, entry, q, members)) {
        continue;
      }
      const kind = kindOfEntry(entry);
      kindCounts[kind] += 1;
      if (kinds === null || kinds.has(kind)) {
        matched.push(path);
      }
    }
    return { kindCounts, matched, total: matched.length };
  }

  private passes(
    path: string,
    entry: Entry,
    q: ItemQuery,
    members: ReadonlySet<string> | null,
  ): boolean {
    const facts = entry.kind === "doc" ? entry.facts : null;
    return (
      inFolder(path, q.folder, q.subfolders) &&
      (members === null || members.has(path)) &&
      (!q.untagged || entry.kind === "other" || !entry.tagged) &&
      (q.site === undefined || siteMatches(facts?.host ?? null, q.site)) &&
      (q.sinceMs === undefined || this.savedKeyOf(path, entry) >= q.sinceMs) &&
      (q.within === undefined || q.within.has(path))
    );
  }

  private rowsOf(paths: readonly string[], resolve: Resolve, tagsOf: TagsOf): ItemRow[] {
    return paths.flatMap((path) => {
      const entry = this.entries.get(path);
      return entry === undefined ? [] : [this.rowOf(path, entry, resolve, tagsOf)];
    });
  }

  private rowOf(path: string, entry: Entry, resolve: Resolve, tagsOf: TagsOf): ItemRow {
    const modifiedMs = this.stats.get(path)?.mtimeMs ?? null;
    const base = { folder: dirnamePath(path), modifiedMs, path, title: titleOf(path, entry) };
    if (entry.kind === "other") {
      return {
        ...base,
        author: null,
        bare: true,
        copy: null,
        cover: entry.media === "image" ? path : null,
        description: null,
        fetchError: null,
        fetched: null,
        file: path,
        fileBytes: this.stats.get(path)?.size ?? null,
        host: null,
        id: null,
        kind: kindOfEntry(entry),
        pending: false,
        pinned: false,
        preview: "",
        published: null,
        saved: null,
        site: null,
        tags: [],
        url: null,
      };
    }
    const { facts } = entry;
    const files = itemFilesOf({
      kind: facts.kind,
      links: entry.links,
      resolve: (link) => resolve(link, path),
    });
    return {
      ...base,
      author: facts.author,
      bare: false,
      copy: files.copy,
      cover: files.cover,
      description: facts.description,
      fetchError: facts.fetchError,
      fetched: facts.fetchedMs === null ? null : formatItemTime(facts.fetchedMs),
      file: files.file,
      fileBytes: files.file === null ? null : (this.stats.get(files.file)?.size ?? null),
      host: facts.host,
      id: entry.noteId,
      kind: facts.kind,
      pending: isItemStub(facts),
      pinned: entry.pinned,
      preview: entry.preview,
      published: facts.published,
      saved: facts.savedMs === null ? null : formatItemTime(facts.savedMs),
      site: facts.site,
      tags: tagsOf(path),
      url: facts.url,
    };
  }
}
