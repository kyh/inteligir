// The library as a folder in today's vault format, the files a zip is written from: each item one
// markdown file named for its title in its folder, the filing rules as `AGENTS.md` at the root, its
// highlights' store under `.inteligir/annotations/`, and every file it holds once under `assets/`
// (a saved link's cover under `assets/covers/` and its page copy under `assets/pages/`, as the
// vault's writers put them). A file is written under the name it was saved under, so a `.canvas`
// stays one; only bytes no name came with take an extension from their media type. A link is
// written by the shortest target that resolves back to its item among the exported files
// (`wikiTargetForPath`), so the folder reads back into the same library.
//
// The plan is made a step at a time over a store its writer keeps (`ExportStore`), so a writer
// holds one item and its own page of the plan, never the library's: every path is taken in the
// store, each item is given its file (`planExportDoc`) before any is written, then each item is
// written alone (`exportDoc`), its link targets spelled from the files that share their keys
// (`exportTarget`), and the files the items hold are written last, in the order they were placed.

import { annotationsStorePath } from "@repo/notes/annotations/store-schema";
import {
  contentAddressedName,
  COVERS_DIR,
  LIBRARY_RULES_PATH,
  PAGES_DIR,
} from "@repo/notes/items/item-kind";
import { itemNameFromTitle } from "@repo/notes/items/item-name";
import { DEFAULT_ATTACHMENTS_FOLDER, freeAssetPathWhere } from "@repo/notes/knowledge/asset-name";
import { freePath, freePathFrom } from "@repo/notes/knowledge/doc-file";
import { buildResolver, wikiTargetForPath } from "@repo/notes/knowledge/link-resolve";
import { joinPath, vaultCollisionKey } from "@repo/notes/knowledge/vault-path";

import { exportItem } from "./item-markdown";
import type { ExportItem, HeldFile } from "./item-markdown";
import type { WrittenFile } from "./write-blocks";

export interface ExportFolder {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
}

// what names an item's file: its title, its folder and its aliases, which a link may resolve by
export interface ExportItemHead {
  readonly id: string;
  readonly title: string;
  readonly folderId: string | null;
  readonly aliases: readonly string[];
}

export type ExportFile =
  | { readonly kind: "text"; readonly path: string; readonly text: string }
  | { readonly kind: "bytes"; readonly path: string; readonly sha: string };

// what the plan keeps between its steps, wherever its writer keeps it
export interface ExportStore {
  // whether a path is taken, by the key a disk that folds case and normalization sees
  readonly taken: (key: string) => boolean;
  readonly take: (key: string, path: string) => void;
  // how far the search for a free spelling of a name got, by the key of its first spelling
  readonly searched: (key: string) => number | null;
  readonly search: (key: string, n: number) => void;
  // the place a file was given, by what it is (its role and its sha), or null before it has one
  readonly placed: (key: string) => string | null;
  // a file given its place, the bytes to write there later, in the order of the calls
  readonly place: (key: string, file: { readonly path: string; readonly sha: string }) => void;
}

// an item's file in the plan, and the name its title is written under
export interface PlannedExportDoc {
  readonly name: string;
  readonly path: string;
}

// a file's extension from its media type
const MEDIA_EXTENSIONS = new Map<string, string>([
  ["application/json", "json"],
  ["application/pdf", "pdf"],
  ["audio/aac", "aac"],
  ["audio/flac", "flac"],
  ["audio/mp4", "m4a"],
  ["audio/mpeg", "mp3"],
  ["audio/ogg", "ogg"],
  ["audio/wav", "wav"],
  ["image/apng", "apng"],
  ["image/avif", "avif"],
  ["image/bmp", "bmp"],
  ["image/gif", "gif"],
  ["image/heic", "heic"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/svg+xml", "svg"],
  ["image/webp", "webp"],
  ["image/x-icon", "ico"],
  ["text/html", "html"],
  ["text/markdown", "md"],
  ["text/plain", "txt"],
  ["video/mp4", "mp4"],
  ["video/quicktime", "mov"],
  ["video/webm", "webm"],
  ["video/x-m4v", "m4v"],
]);

const extensionOf = (mediaType: string | null): string =>
  (mediaType === null ? undefined : MEDIA_EXTENSIONS.get(mediaType.split(";")[0]?.trim() ?? "")) ??
  "bin";

const UNTITLED = "Untitled";
const FOLDER_DEPTH_MAX = 64;
const DOC_EXTENSION = ".md";

const isTaken =
  (store: ExportStore) =>
  (path: string): boolean =>
    store.taken(vaultCollisionKey(path));

const take = (store: ExportStore, path: string): string => {
  store.take(vaultCollisionKey(path), path);
  return path;
};

// the plan begun: the rules' name taken first, so no item is written over them
export const beginExport = (store: ExportStore): void => {
  take(store, LIBRARY_RULES_PATH);
};

// the library's filing rules, written at the root
export const rulesFile = (rules: string): ExportFile => ({
  kind: "text",
  path: LIBRARY_RULES_PATH,
  text: rules,
});

// every folder's path, each name made one a disk holds and told from its siblings
export const exportFolderPaths = (folders: readonly ExportFolder[]): Map<string, string> => {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const paths = new Map<string, string>();
  const taken = new Set<string>();
  const pathOf = (id: string, depth: number): string => {
    const known = paths.get(id);
    const folder = byId.get(id);
    if (known !== undefined || folder === undefined || depth > FOLDER_DEPTH_MAX) {
      return known ?? "";
    }
    const parent = folder.parentId === null ? "" : pathOf(folder.parentId, depth + 1);
    const name = itemNameFromTitle(folder.name) ?? "Folder";
    const path = freePath(parent, name, "", (candidate) => taken.has(vaultCollisionKey(candidate)));
    taken.add(vaultCollisionKey(path));
    paths.set(id, path);
    return path;
  };
  for (const folder of folders) {
    pathOf(folder.id, 0);
  }
  return paths;
};

// an item given its file, named for its title in its folder (`dir`, the folder's path), the first
// spelling no other file holds
export const planExportDoc = (
  head: ExportItemHead,
  dir: string,
  store: ExportStore,
): PlannedExportDoc => {
  const name = itemNameFromTitle(head.title) ?? UNTITLED;
  const searchKey = vaultCollisionKey(joinPath(dir, `${name}${DOC_EXTENSION}`));
  const free = freePathFrom(
    dir,
    name,
    DOC_EXTENSION,
    isTaken(store),
    store.searched(searchKey) ?? 1,
  );
  store.search(searchKey, free.n);
  return { name, path: take(store, free.path) };
};

// the link a file is written by among `candidates`, every file filed under one of
// `wikiTargetKeys(path)` (`@repo/notes/knowledge/link-resolve`), which answer as the whole plan does
export const exportTarget = (
  path: string,
  candidates: readonly { readonly path: string; readonly aliases: readonly string[] }[],
): string => {
  const resolver = buildResolver(
    candidates.map((candidate) => candidate.path),
    candidates.flatMap((candidate) =>
      candidate.aliases.map((alias): [string, string] => [alias, candidate.path]),
    ),
  );
  return wikiTargetForPath(path, (target) => resolver.resolveWiki(target));
};

export interface ExportDocPorts {
  readonly store: ExportStore;
  // a file's media type, by its sha: the extension of bytes no name came with
  readonly mediaType: (sha: string) => string | null;
  // the link an item is written by, null for one no file of the plan holds
  readonly target: (itemId: string) => string | null;
}

const contentAddressed = (dir: string, sha: string, extension: string): string =>
  joinPath(dir, contentAddressedName(sha, extension));

// every file an item holds, given one place per sha and role, in the vault's own places
const filePlaces = (ports: ExportDocPorts, title: string) => {
  const { mediaType, store } = ports;
  const assign = (key: string, sha: string, choose: () => string): string => {
    const held = store.placed(key);
    if (held !== null) {
      return held;
    }
    const path = take(store, choose());
    store.place(key, { path, sha });
    return path;
  };
  // an asset by its own name, under a folder of its bytes when another file holds that name
  const named = (sha: string, name: string): string => {
    const plain = joinPath(DEFAULT_ATTACHMENTS_FOLDER, name);
    return isTaken(store)(plain)
      ? joinPath(DEFAULT_ATTACHMENTS_FOLDER, `${sha.slice(0, 16)}/${name}`)
      : plain;
  };
  const byName = (sha: string, name: string): string =>
    assign(`named:${sha}:${name}`, sha, () => named(sha, name));
  return {
    body: (file: WrittenFile): string =>
      file.name === null
        ? assign(`body:${file.sha}`, file.sha, () =>
            contentAddressed(
              DEFAULT_ATTACHMENTS_FOLDER,
              file.sha,
              extensionOf(mediaType(file.sha)),
            ),
          )
        : byName(file.sha, file.name),
    held: (file: HeldFile): string => {
      const { sha } = file;
      switch (file.role) {
        case "cover": {
          return assign(`cover:${sha}`, sha, () =>
            contentAddressed(COVERS_DIR, sha, extensionOf(mediaType(sha))),
          );
        }
        case "copy": {
          return assign(`copy:${sha}`, sha, () => contentAddressed(PAGES_DIR, sha, "html"));
        }
        case "original": {
          return file.name === null
            ? assign(`original:${sha}`, sha, () =>
                freeAssetPathWhere(
                  DEFAULT_ATTACHMENTS_FOLDER,
                  `${title}.${extensionOf(mediaType(sha))}`,
                  isTaken(store),
                ),
              )
            : byName(sha, file.name);
        }
        // no default
      }
    },
  };
};

// one item's files as the plan gave it its place: its markdown, and its highlights' store when it
// keeps any; the files it holds are given their places in the store, to be written last
export const exportDoc = (
  item: ExportItem,
  doc: PlannedExportDoc,
  ports: ExportDocPorts,
): ExportFile[] => {
  const places = filePlaces(ports, doc.name);
  // a file's name cuts and mends what a title may hold, so a title it cannot carry is written
  const exported = exportItem(
    item,
    { held: places.held, path: places.body, target: ports.target, withIds: false },
    doc.name === item.fields.title ? null : item.fields.title,
  );
  const files: ExportFile[] = [{ kind: "text", path: doc.path, text: exported.text }];
  if (exported.annotations !== null) {
    files.push({ kind: "text", path: annotationsStorePath(item.id), text: exported.annotations });
  }
  return files;
};
