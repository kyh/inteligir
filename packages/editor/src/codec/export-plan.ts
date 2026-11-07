// The library as a folder of markdown, the files a zip is written from: each item one
// markdown file named for its title in its folder, the filing rules as `AGENTS.md` at the root, its
// highlights' store under `.inteligir/annotations/`, and every file it holds once under `assets/`
// (a saved link's cover under `assets/covers/`, where an import looks for it). A file is written
// under the name it was saved under, so a `.canvas` stays one, in a folder of its bytes where that
// name alone would read as a note or be passed over; only bytes no name came with take an extension
// from their media type. A link is written by the shortest target that resolves back to its item
// among the exported files (`wikiTargetForPath`), so the folder reads back into the same library.
//
// The plan is made a step at a time over a store its writer keeps (`ExportStore`), so a writer
// holds one item and its own page of the plan, never the library's: every path is taken in the
// store, each item is given its file (`planExportDoc`) before any is written, then each item is
// written alone (`exportDoc`), its link targets spelled from the files that share their keys
// (`exportTarget`), and the files the items hold are written last, in the order they were placed.

import { annotationsStorePath } from "@repo/notes/annotations/store-schema";
import {
  bytesFolderPath,
  contentAddressedName,
  COVERS_DIR,
  extensionOfMediaType,
  LIBRARY_RULES_PATH,
} from "@repo/notes/items/item-kind";
import { itemNameFromTitle } from "@repo/notes/items/item-name";
import { DEFAULT_ATTACHMENTS_FOLDER, freeAssetPathWhere } from "@repo/notes/knowledge/asset-name";
import { docStem, freePath, freePathFrom } from "@repo/notes/knowledge/doc-file";
import { mdLinkUrl } from "@repo/notes/knowledge/link-extract";
import { buildResolver, wikiTargetForPath } from "@repo/notes/knowledge/link-resolve";
import { basenamePath, joinPath, pathCollisionKey } from "@repo/notes/knowledge/folder-path";

import { importPathKind } from "./import-plan";
import { exportItem } from "./item-markdown";
import type { ExportItem, HeldFile } from "./item-markdown";
import type { WrittenFile } from "./write-blocks";

export interface ExportFolder {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
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

const extensionOf = (mediaType: string | null): string =>
  (mediaType === null ? null : extensionOfMediaType(mediaType)) ?? "bin";

const UNTITLED = "Untitled";
const FOLDER_DEPTH_MAX = 64;
const DOC_EXTENSION = ".md";

const isTaken =
  (store: ExportStore) =>
  (path: string): boolean =>
    store.taken(pathCollisionKey(path));

const take = (store: ExportStore, path: string): string => {
  store.take(pathCollisionKey(path), path);
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
    const path = freePath(parent, name, "", (candidate) => taken.has(pathCollisionKey(candidate)));
    taken.add(pathCollisionKey(path));
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
export const planExportDoc = (title: string, dir: string, store: ExportStore): PlannedExportDoc => {
  const name = itemNameFromTitle(title) ?? UNTITLED;
  const searchKey = pathCollisionKey(joinPath(dir, `${name}${DOC_EXTENSION}`));
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

// a path an import would read as a note or pass over gives way to a folder of the file's bytes
const readable = (sha: string, path: string): string =>
  importPathKind(path) === "file" ? path : bytesFolderPath(sha, basenamePath(path));

// every file an item holds, given one place per sha and role, in the places an import reads
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
    return isTaken(store)(plain) ? bytesFolderPath(sha, name) : readable(sha, plain);
  };
  const byName = (sha: string, name: string): string =>
    assign(`named:${sha}:${name}`, sha, () => named(sha, name));
  return {
    body: (file: WrittenFile): string =>
      file.name === null
        ? assign(`body:${file.sha}`, file.sha, () =>
            readable(
              file.sha,
              contentAddressed(
                DEFAULT_ATTACHMENTS_FOLDER,
                file.sha,
                extensionOf(mediaType(file.sha)),
              ),
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
        case "original": {
          return file.name === null
            ? assign(`original:${sha}`, sha, () =>
                readable(
                  sha,
                  freeAssetPathWhere(
                    DEFAULT_ATTACHMENTS_FOLDER,
                    `${title}.${extensionOf(mediaType(sha))}`,
                    isTaken(store),
                  ),
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
  // a file's name cuts and mends what a title may hold and numbers one another file took, so a
  // title it cannot carry is written
  const exported = exportItem(
    item,
    {
      held: (file) => mdLinkUrl(places.held(file)),
      path: (file) => mdLinkUrl(places.body(file)),
      target: ports.target,
      withIds: false,
    },
    docStem(doc.path) === item.fields.title ? null : item.fields.title,
  );
  const files: ExportFile[] = [{ kind: "text", path: doc.path, text: exported.text }];
  if (exported.annotations !== null) {
    files.push({ kind: "text", path: annotationsStorePath(item.id), text: exported.annotations });
  }
  return files;
};
