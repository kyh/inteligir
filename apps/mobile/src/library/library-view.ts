// What the phone's Library lists, from the cards the mirror read once per text: every item in a
// scope, narrowed by kind and a typed query, newest save first. Its members are the Mac's: every
// doc, and every picture, PDF, video or sound no doc names, by the Mac's own keys. Pure: the
// screens and the tests call it over the held files. A card's cover and original are resolved
// here, through one resolver per listing, never stored.

import { itemFilesOf } from "@repo/notes/items/item-files";
import { isItemStub } from "@repo/notes/items/item-frontmatter";
import {
  COVERS_DIR,
  LIBRARY_RULES_PATH,
  PAGES_DIR,
  UNSORTED_FOLDER,
} from "@repo/notes/items/item-kind";
import type { ItemKind } from "@repo/notes/items/item-kind";
import { fileRefsOf, mediaKindOf, refsOf } from "@repo/notes/items/library-index";
import { DEFAULT_ATTACHMENTS_FOLDER } from "@repo/notes/knowledge/asset-name";
import { docStem, isDocPath, isVaultMetadataPath } from "@repo/notes/knowledge/doc-file";
import type { ExtractedLink } from "@repo/notes/knowledge/link-extract";
import { buildResolver } from "@repo/notes/knowledge/link-resolve";
import type { TargetResolver } from "@repo/notes/knowledge/link-resolve";
import { dirnamePath } from "@repo/notes/knowledge/vault-path";
import type { HeldFile } from "../notes/notes-store";

export type PhoneScope =
  | { kind: "all" }
  | { kind: "unsorted" }
  | { kind: "folder"; path: string }
  | { kind: "tag"; tag: string };

export interface LibraryFilter {
  scope: PhoneScope;
  // none: every kind
  kinds: ReadonlySet<ItemKind>;
  query: string;
}

export interface LibraryCard {
  path: string;
  title: string;
  kind: ItemKind;
  // the publisher's name, else the link's host
  site: string | null;
  url: string | null;
  // unix ms; null for an item that never said when it was saved
  saved: number | null;
  tags: readonly string[];
  folder: string;
  cover: string | null;
  file: string | null;
  // a link whose page no Mac has read yet
  pending: boolean;
}

export interface LibraryScopes {
  folders: string[];
  tags: { tag: string; count: number }[];
}

// the library's filing rules, another app's settings, and the covers and page copies an item
// shows rather than is
const isHidden = (path: string): boolean =>
  path.toLowerCase() === LIBRARY_RULES_PATH.toLowerCase() ||
  isVaultMetadataPath(path) ||
  path.startsWith(`${COVERS_DIR}/`) ||
  path.startsWith(`${PAGES_DIR}/`);

// the keys every held doc names a file by
const namedKeys = (files: readonly HeldFile[]): Set<string> =>
  new Set(files.flatMap((file) => [...refsOf(file.path, file.item?.media ?? [])]));

// a member of the library: a doc, or a media file no doc names (a bare file), as on the Mac
const isItemAmong =
  (named: ReadonlySet<string>) =>
  (file: HeldFile): boolean => {
    if (isDocPath(file.path)) {
      return !isHidden(file.path);
    }
    return (
      !isHidden(file.path) &&
      mediaKindOf(file.path) !== null &&
      fileRefsOf(file.path).every((key) => !named.has(key))
    );
  };

const basenameStem = (path: string): string => {
  const name = path.split("/").at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
};

const isUnder = (folder: string, root: string): boolean =>
  folder === root || folder.startsWith(`${root}/`);

// `#a` and `a` name one tag, in any case; a nested tag is in its parent's family
const tagKey = (tag: string): string => (tag.startsWith("#") ? tag.slice(1) : tag).toLowerCase();

const inTagFamily = (tags: readonly string[], wanted: string): boolean => {
  const key = tagKey(wanted);
  return tags.some((tag) => {
    const held = tagKey(tag);
    return held === key || held.startsWith(`${key}/`);
  });
};

const inScope = (card: LibraryCard, scope: PhoneScope): boolean => {
  switch (scope.kind) {
    case "all": {
      return true;
    }
    case "unsorted": {
      return isUnder(card.folder, UNSORTED_FOLDER);
    }
    case "folder": {
      return isUnder(card.folder, scope.path);
    }
    case "tag": {
      return inTagFamily(card.tags, scope.tag);
    }
    // no default
  }
};

const matchesQuery = (card: LibraryCard, query: string): boolean => {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") {
    return true;
  }
  return [card.title, card.site, card.url].some(
    (text) => text !== null && text.toLowerCase().includes(wanted),
  );
};

const resolverOf = (files: readonly HeldFile[]): TargetResolver =>
  buildResolver(
    files.map((file) => file.path),
    files.flatMap((file) => file.aliases.map((alias): [string, string] => [alias, file.path])),
    files.flatMap((file): [string, string][] =>
      file.noteId === null ? [] : [[file.noteId, file.path]],
    ),
  );

// a bare file's card: the file is its own original, and a picture its own cover
const bareCardOf = (path: string): LibraryCard => {
  const kind = mediaKindOf(path) ?? "file";
  return {
    cover: kind === "image" ? path : null,
    file: path,
    folder: dirnamePath(path),
    kind,
    path,
    pending: false,
    saved: null,
    site: null,
    tags: [],
    title: basenameStem(path),
    url: null,
  };
};

const cardOf = (file: HeldFile, resolver: TargetResolver): LibraryCard => {
  const { item, path } = file;
  if (!isDocPath(path)) {
    return bareCardOf(path);
  }
  const resolve = (link: ExtractedLink): string | null => {
    const target =
      link.kind === "wiki"
        ? resolver.resolveWiki(link.target, link.alias)
        : resolver.resolveMd(link.target, path);
    return target === null || isDocPath(target) ? null : target;
  };
  const facts = item?.facts ?? null;
  const kind = facts?.kind ?? "note";
  const files = itemFilesOf({ kind, links: item?.links ?? [], resolve });
  return {
    cover: files.cover,
    file: files.file,
    folder: dirnamePath(path),
    kind,
    path,
    pending: facts !== null && isItemStub(facts),
    saved: facts?.savedMs ?? null,
    site: facts?.site ?? facts?.host ?? null,
    tags: item?.tags ?? [],
    title: docStem(path),
    url: facts?.url ?? null,
  };
};

// newest save first; an item that never said when it was saved goes last, then by path
const bySaved = (a: LibraryCard, b: LibraryCard): number => {
  if (a.saved !== b.saved) {
    if (a.saved === null) {
      return 1;
    }
    if (b.saved === null) {
      return -1;
    }
    return b.saved - a.saved;
  }
  if (a.path === b.path) {
    return 0;
  }
  return a.path < b.path ? -1 : 1;
};

// whether the Library under `filter` lists the card
export const cardMatches = (card: LibraryCard, filter: LibraryFilter): boolean =>
  inScope(card, filter.scope) &&
  (filter.kinds.size === 0 || filter.kinds.has(card.kind)) &&
  matchesQuery(card, filter.query);

export const libraryCards = (files: readonly HeldFile[], filter: LibraryFilter): LibraryCard[] => {
  const resolver = resolverOf(files);
  return files
    .filter(isItemAmong(namedKeys(files)))
    .map((file) => cardOf(file, resolver))
    .filter((card) => cardMatches(card, filter))
    .toSorted(bySaved);
};

// every folder above an item's
const foldersAbove = (folder: string): string[] => {
  const out: string[] = [];
  for (let at = folder; at !== ""; at = dirnamePath(at)) {
    out.push(at);
  }
  return out;
};

// the folders a person files into (Unsorted is a scope of its own, and the attachments folder holds
// what items show), and every tag with how many items carry it, most used first
export const libraryScopes = (files: readonly HeldFile[]): LibraryScopes => {
  const folders = new Set<string>();
  const tags = new Map<string, { tag: string; count: number }>();
  const isItem = isItemAmong(namedKeys(files));
  for (const file of files) {
    if (!isItem(file)) {
      continue;
    }
    for (const folder of foldersAbove(dirnamePath(file.path))) {
      if (!isUnder(folder, UNSORTED_FOLDER) && !isUnder(folder, DEFAULT_ATTACHMENTS_FOLDER)) {
        folders.add(folder);
      }
    }
    const seen = new Set<string>();
    for (const tag of file.item?.tags ?? []) {
      const key = tagKey(tag);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const held = tags.get(key);
      tags.set(key, { count: (held?.count ?? 0) + 1, tag: held?.tag ?? tag });
    }
  }
  return {
    folders: [...folders].toSorted((a, b) => a.localeCompare(b)),
    tags: [...tags.values()].toSorted((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
  };
};

// one item's card, as the Library would list it; null for a path the phone does not list as one
export const libraryCardAt = (files: readonly HeldFile[], path: string): LibraryCard | null => {
  const file = files.find((held) => held.path === path);
  return file === undefined || !isItemAmong(namedKeys(files))(file)
    ? null
    : cardOf(file, resolverOf(files));
};
