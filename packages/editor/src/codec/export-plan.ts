// The library as a folder in today's vault format, the file list a zip is written from: each item
// one markdown file named for its title in its folder, the filing rules as `AGENTS.md` at the
// root, its highlights' store under `.inteligir/annotations/`, and every file it holds once under
// `assets/` (a saved link's cover under `assets/covers/` and its page copy under `assets/pages/`,
// as the vault's writers put them). A file is written under the name it was saved under, so a
// `.canvas` stays one; only bytes no name came with take an extension from their media type. A
// link is written by the shortest target that resolves back to its item among the exported files
// (`wikiTargetForPath`), so the folder reads back into the same library. The files come one at a
// time, each item read only when its turn comes, so a writer holds one item's text, never the
// library's.

import { annotationsStorePath } from "@repo/notes/annotations/store-schema";
import {
  contentAddressedName,
  COVERS_DIR,
  LIBRARY_RULES_PATH,
  PAGES_DIR,
} from "@repo/notes/items/item-kind";
import { itemNameFromTitle } from "@repo/notes/items/item-name";
import { DEFAULT_ATTACHMENTS_FOLDER, freeAssetPathWhere } from "@repo/notes/knowledge/asset-name";
import { freePath } from "@repo/notes/knowledge/doc-file";
import { buildResolver, wikiTargetForPath } from "@repo/notes/knowledge/link-resolve";
import { joinPath, vaultCollisionKey } from "@repo/notes/knowledge/vault-path";
import type { LibraryItemFields } from "@repo/notes/library/library-item";

import { exportItem } from "./item-markdown";
import type { ExportItem, ExportPorts, HeldFile } from "./item-markdown";
import type { WrittenFile } from "./write-blocks";

interface ExportFolder {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
}

// what names an item's file: its fields alone, its body read when the file is written
export interface ExportItemHead {
  readonly id: string;
  readonly fields: LibraryItemFields;
}

export interface ExportLibrary {
  readonly folders: readonly ExportFolder[];
  // the live items; a deleted one stays in the library
  readonly items: readonly ExportItemHead[];
  // an item whole, read when its file is written; null when it went since its head was read
  readonly read: (head: ExportItemHead) => ExportItem | null;
  // a file's media type, by its sha: the extension of bytes no name came with
  readonly mediaType: (sha: string) => string | null;
  // the library's filing rules, which the agent reads
  readonly rules: string | null;
}

export type ExportFile =
  | { readonly kind: "text"; readonly path: string; readonly text: string }
  | { readonly kind: "bytes"; readonly path: string; readonly sha: string };

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

interface TakenPaths {
  readonly has: (path: string) => boolean;
  readonly take: (path: string) => string;
}

// paths taken, as a disk that folds case and normalization sees them
const takenPaths = (): TakenPaths => {
  const taken = new Set<string>();
  return {
    has: (path: string): boolean => taken.has(vaultCollisionKey(path)),
    take: (path: string): string => {
      taken.add(vaultCollisionKey(path));
      return path;
    },
  };
};

const folderPaths = (folders: readonly ExportFolder[]): Map<string, string> => {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const paths = new Map<string, string>();
  const taken = takenPaths();
  const pathOf = (id: string, depth: number): string => {
    const known = paths.get(id);
    const folder = byId.get(id);
    if (known !== undefined || folder === undefined || depth > FOLDER_DEPTH_MAX) {
      return known ?? "";
    }
    const parent = folder.parentId === null ? "" : pathOf(folder.parentId, depth + 1);
    const name = itemNameFromTitle(folder.name) ?? "Folder";
    const path = taken.take(freePath(parent, name, "", taken.has));
    paths.set(id, path);
    return path;
  };
  for (const folder of folders) {
    pathOf(folder.id, 0);
  }
  return paths;
};

const contentAddressed = (dir: string, sha: string, extension: string): string =>
  joinPath(dir, contentAddressedName(sha, extension));

// every file an item holds, given one path per sha and role, in the vault's own places
const filePaths = (mediaType: ExportLibrary["mediaType"], taken: TakenPaths) => {
  const assigned = new Map<string, string>();
  const bytes: ExportFile[] = [];
  const assign = (key: string, sha: string, choose: () => string): string => {
    const held = assigned.get(key);
    if (held !== undefined) {
      return held;
    }
    const path = taken.take(choose());
    assigned.set(key, path);
    bytes.push({ kind: "bytes", path, sha });
    return path;
  };
  // an asset by its own name, under a folder of its bytes when another file holds that name
  const named = (sha: string, name: string): string => {
    const plain = joinPath(DEFAULT_ATTACHMENTS_FOLDER, name);
    return taken.has(plain)
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
    bytes,
    held: (file: HeldFile, title: string): string => {
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
                  taken.has,
                ),
              )
            : byName(sha, file.name);
        }
        // no default
      }
    },
  };
};

// the whole library as the files of a folder, the texts as each item is read and then the bytes
export const planExport = function* planExport(
  library: ExportLibrary,
): Generator<ExportFile, void, undefined> {
  const folders = folderPaths(library.folders);
  // one set for every file written, the rules' name first, so no item is written over them
  const taken = takenPaths();
  taken.take(LIBRARY_RULES_PATH);
  const docs = library.items.map((head) => {
    const name = itemNameFromTitle(head.fields.title) ?? UNTITLED;
    const dir = head.fields.folderId === null ? "" : (folders.get(head.fields.folderId) ?? "");
    const path = taken.take(freePath(dir, name, ".md", taken.has));
    return { head, name, path };
  });
  const resolver = buildResolver(
    docs.map((doc) => doc.path),
    docs.flatMap((doc) =>
      doc.head.fields.aliases.map((alias): [string, string] => [alias, doc.path]),
    ),
  );
  const pathById = new Map(docs.map((doc) => [doc.head.id, doc.path]));
  const files = filePaths(library.mediaType, taken);
  if (library.rules !== null) {
    yield { kind: "text", path: LIBRARY_RULES_PATH, text: library.rules };
  }
  for (const { head, name, path } of docs) {
    const item = library.read(head);
    if (item === null) {
      continue;
    }
    const ports: ExportPorts = {
      held: (file) => files.held(file, name),
      path: files.body,
      target: (itemId) => {
        const target = pathById.get(itemId);
        return target === undefined ? null : wikiTargetForPath(target, resolver.resolveWiki);
      },
      withIds: false,
    };
    // a file's name cuts and mends what a title may hold, so a title it cannot carry is written
    const exported = exportItem(item, ports, name === item.fields.title ? null : item.fields.title);
    yield { kind: "text", path, text: exported.text };
    if (exported.annotations !== null) {
      yield { kind: "text", path: annotationsStorePath(item.id), text: exported.annotations };
    }
  }
  yield* files.bytes;
};
