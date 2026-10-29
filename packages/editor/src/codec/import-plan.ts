// A folder of markdown, a vault from this app or one from Obsidian, read into the library in two
// passes, so a job can run the second a page at a time and resume. Pass one plans from every path
// and every doc's frontmatter: each folder, each doc's item and id, every file's bytes, and every
// highlights' store. Pass two reads one doc at a time against the whole plan, resolving its links
// with the vault's own tiers (path, name, alias, then the `[[Title|uuid]]` id,
// `@repo/notes/knowledge/link-resolve`). Last, every file no doc embedded becomes an item of its
// own, as a bare file was a card of its own in the vault. Obsidian's settings (`.obsidian/`) and
// every other dot-folder are skipped, the vault's filing rules (`AGENTS.md` at its root) are kept
// apart from every item, and a `.canvas` or a `.base` is always an item, never an attachment.

import { annotationsStoreItemId } from "@repo/notes/annotations/store-schema";
import { COVERS_DIR, fileKindOf, LIBRARY_RULES_PATH, PAGES_DIR } from "@repo/notes/items/item-kind";
import type { FileKind } from "@repo/notes/items/item-kind";
import { urlKey } from "@repo/notes/items/item-url";
import { docStem, isDocPath, isVaultMetadataPath } from "@repo/notes/knowledge/doc-file";
import { frontmatterAliases, mdLinkTarget } from "@repo/notes/knowledge/link-extract";
import { buildResolver } from "@repo/notes/knowledge/link-resolve";
import type { TargetResolver } from "@repo/notes/knowledge/link-resolve";
import {
  basenamePath,
  dirnamePath,
  extnamePath,
  normalizePath,
  relativePath,
} from "@repo/notes/knowledge/vault-path";
import { frontmatterYaml, parseProperties } from "@repo/notes/markdown/frontmatter";
import type { WikiBody } from "@repo/notes/markdown/remark-wiki-link";

import { readFrontmatter } from "./item-fields";
import { importItem } from "./item-markdown";
import type { FoundFile, ImportedFields, ImportedItem } from "./item-markdown";
import type { Reached } from "./read-blocks";

// what a path in the folder is to an import
export type ImportPathKind = "doc" | "file" | "rules" | "store" | "skipped";

// Obsidian's whiteboard and its database view: files of their own, never shown inside a note
const ITEM_ONLY_EXTENSIONS = new Set([".canvas", ".base"]);

export const importPathKind = (raw: string): ImportPathKind => {
  const path = normalizePath(raw);
  if (annotationsStoreItemId(path) !== null) {
    return "store";
  }
  if (path === "" || isVaultMetadataPath(path)) {
    return "skipped";
  }
  if (path.toLowerCase() === LIBRARY_RULES_PATH.toLowerCase()) {
    return "rules";
  }
  return isDocPath(path) ? "doc" : "file";
};

// one path of the folder, as pass one reads it: a doc's, the rules' or a store's text, a file's
// bytes by sha
export type ImportEntry =
  | { readonly kind: "doc"; readonly path: string; readonly text: string }
  | { readonly kind: "rules"; readonly path: string; readonly text: string }
  | { readonly kind: "store"; readonly path: string; readonly text: string }
  | { readonly kind: "file"; readonly path: string; readonly sha: string };

export interface PlannedFolder {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly path: string;
}

export interface PlannedDoc {
  readonly path: string;
  readonly itemId: string;
  readonly title: string;
  readonly folderId: string | null;
  // the `id:` its frontmatter carries, which its store and other docs' `[[Title|uuid]]` key by
  readonly fileId: string | null;
  readonly aliases: readonly string[];
  // the url key its frontmatter names, by which the cell folds two saves of one page into one item
  readonly urlKey: string | null;
}

interface PlannedFile {
  readonly path: string;
  readonly sha: string;
  readonly kind: FileKind;
}

// pass one's answer, plain data a resumable job keeps between its pages
export interface ImportPlan {
  readonly folders: readonly PlannedFolder[];
  readonly docs: readonly PlannedDoc[];
  readonly files: readonly PlannedFile[];
  // the docs' highlight stores, each by the frontmatter id it is keyed by
  readonly stores: readonly { readonly key: string; readonly text: string }[];
  // the library's filing rules, which the agent reads and no item holds
  readonly rules: string | null;
}

export interface PlanIds {
  readonly newItemId: () => string;
  readonly newFolderId: () => string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

interface FolderTable {
  readonly folders: PlannedFolder[];
  readonly idOf: (dir: string) => string | null;
}

// a folder for every directory an item sits in, and every directory above one; a directory a
// table before this one made keeps its folder
const folderTable = (
  newFolderId: () => string,
  known: ReadonlyMap<string, string> = new Map(),
): FolderTable => {
  const folders: PlannedFolder[] = [];
  const ids = new Map(known);
  const idOf = (dir: string): string | null => {
    if (dir === "") {
      return null;
    }
    const held = ids.get(dir);
    if (held !== undefined) {
      return held;
    }
    const parentId = idOf(dirnamePath(dir));
    const id = newFolderId();
    ids.set(dir, id);
    folders.push({ id, name: basenamePath(dir), parentId, path: dir });
    return id;
  };
  return { folders, idOf };
};

interface DocFront {
  readonly fileId: string | null;
  readonly title: string;
  readonly aliases: readonly string[];
  readonly urlKey: string | null;
}

const docFront = (path: string, text: string): DocFront => {
  const yaml = frontmatterYaml(text);
  const read = readFrontmatter(yaml, docStem(path), 0);
  return {
    aliases: frontmatterAliases(parseProperties(yaml ?? "")),
    fileId: read.id,
    title: read.fields.title,
    urlKey: read.fields.url === null ? null : urlKey(read.fields.url),
  };
};

// pass one: every path planned, an item id minted for each doc (its own uuid kept when it has an
// unused one), and the resolver every doc's links are read through
export const planImport = (entries: readonly ImportEntry[], ids: PlanIds): ImportPlan => {
  const table = folderTable(ids.newFolderId);
  const docs: PlannedDoc[] = [];
  const files: PlannedFile[] = [];
  const stores: { key: string; text: string }[] = [];
  const usedIds = new Set<string>();
  let rules: string | null = null;
  for (const entry of entries) {
    const path = normalizePath(entry.path);
    switch (entry.kind) {
      case "rules": {
        rules = entry.text;
        break;
      }
      case "store": {
        const key = annotationsStoreItemId(path);
        if (key !== null) {
          stores.push({ key, text: entry.text });
        }
        break;
      }
      case "file": {
        files.push({ kind: fileKindOf(path) ?? "file", path, sha: entry.sha });
        break;
      }
      case "doc": {
        const front = docFront(path, entry.text);
        const own =
          front.fileId !== null && UUID_RE.test(front.fileId) ? front.fileId.toLowerCase() : null;
        const itemId = own !== null && !usedIds.has(own) ? own : ids.newItemId();
        usedIds.add(itemId);
        docs.push({
          aliases: front.aliases,
          fileId: front.fileId,
          folderId: table.idOf(dirnamePath(path)),
          itemId,
          path,
          title: front.title,
          urlKey: front.urlKey,
        });
        break;
      }
      // no default
    }
  }
  return { docs, files, folders: table.folders, rules, stores };
};

// a plan opened for pass two: its lookups and its resolver, built once for every doc it reads
export interface PlanReader {
  readonly plan: ImportPlan;
  readonly resolver: TargetResolver;
  readonly docs: ReadonlyMap<string, PlannedDoc>;
  readonly files: ReadonlyMap<string, PlannedFile>;
  readonly stores: ReadonlyMap<string, string>;
}

export const openPlan = (plan: ImportPlan): PlanReader => ({
  docs: new Map(plan.docs.map((doc) => [doc.path, doc])),
  files: new Map(plan.files.map((file) => [file.path, file])),
  plan,
  resolver: buildResolver(
    [...plan.docs.map((doc) => doc.path), ...plan.files.map((file) => file.path)],
    plan.docs.flatMap((doc) => doc.aliases.map((alias): [string, string] => [alias, doc.path])),
    plan.docs.flatMap((doc): [string, string][] =>
      doc.fileId === null ? [] : [[doc.fileId, doc.path]],
    ),
  ),
  stores: new Map(plan.stores.map((store) => [store.key, store.text])),
});

export interface ReadPassPorts {
  readonly newBlockId: () => string;
  readonly newAnnotationId: () => string;
  readonly now: number;
}

interface ImportedDoc {
  readonly doc: PlannedDoc;
  readonly item: ImportedItem;
  // the files the doc embeds or links, which pass three keeps as attachments
  readonly files: ReadonlySet<string>;
}

export type DocImport =
  | { readonly ok: true; readonly read: ImportedDoc }
  | { readonly ok: false; readonly path: string; readonly reason: "too-deep" };

// pass two: one doc read against the whole plan
export const importPlannedDoc = (
  reader: PlanReader,
  doc: PlannedDoc,
  text: string,
  ports: ReadPassPorts,
): DocImport => {
  const { docs, files } = reader;
  const used = new Set<string>();
  const fromDir = dirnamePath(doc.path);
  const fileAt = (path: string): FoundFile | null => {
    const file = files.get(path);
    if (file === undefined) {
      return null;
    }
    used.add(file.sha);
    return {
      kind: file.kind,
      name: basenamePath(path),
      path: relativePath(fromDir, path),
      place: path,
      sha: file.sha,
    };
  };
  const reachedAt = (path: string | null, embed: boolean): Reached => {
    const target = path === null ? undefined : docs.get(path);
    if (target !== undefined) {
      return { itemId: target.itemId, kind: "item", title: target.title };
    }
    const file = path === null || !embed ? null : fileAt(path);
    return file === null ? null : { file, kind: "file" };
  };
  const wiki = (link: WikiBody, embed: boolean): Reached =>
    link.target === ""
      ? { itemId: doc.itemId, kind: "item", title: doc.title }
      : reachedAt(reader.resolver.resolveWiki(link.target, link.alias), embed);
  const file = (url: string): FoundFile | null => {
    const target = mdLinkTarget(url);
    const path = target === null ? null : reader.resolver.resolveMd(target, doc.path);
    return path === null ? null : fileAt(path);
  };
  const read = importItem(
    {
      annotations: doc.fileId === null ? null : (reader.stores.get(doc.fileId) ?? null),
      name: docStem(doc.path),
      text,
    },
    {
      file,
      newAnnotationId: ports.newAnnotationId,
      newBlockId: ports.newBlockId,
      now: ports.now,
      wiki,
    },
  );
  return read.ok
    ? { ok: true, read: { doc, files: used, item: read.item } }
    : { ok: false, path: doc.path, reason: read.reason };
};

interface PlannedFileItem {
  readonly itemId: string;
  readonly path: string;
  readonly folderId: string | null;
  readonly fields: ImportedFields;
}

export interface FileItems {
  readonly items: readonly PlannedFileItem[];
  // the folders the file items sit in that no doc's did
  readonly folders: readonly PlannedFolder[];
}

// what pass two read of the files: those a doc embedded or linked, and those a doc held as its own
// original (a wrapper of a file item, as the vault's writers saved one)
export interface ReadFiles {
  readonly attached: ReadonlySet<string>;
  readonly originals: ReadonlySet<string>;
}

// a cover or a page copy, where the vault's writers put them
const structural = (path: string): boolean =>
  path.startsWith(`${COVERS_DIR}/`) || path.startsWith(`${PAGES_DIR}/`);

const fileItemFields = (file: PlannedFile, now: number): ImportedFields => {
  const extension = extnamePath(file.path);
  const name = basenamePath(file.path);
  return {
    aliases: [],
    author: null,
    copySha: null,
    coverSha: file.kind === "image" ? file.sha : null,
    description: null,
    fetchError: null,
    fetchState: "none",
    fetchedAt: null,
    kind: file.kind,
    lang: null,
    originalName: name,
    originalSha: file.sha,
    pinnedAt: null,
    properties: {},
    published: null,
    savedAt: now,
    site: null,
    tags: [],
    title: name.slice(0, name.length - extension.length),
    url: null,
  };
};

// pass three: every file no doc embedded or linked, and every `.canvas` and `.base` no doc held as
// its original, an item of its own in its folder; a cover or a page copy no item holds is no card,
// as it was none in the vault
export const planFileItems = (
  plan: ImportPlan,
  read: ReadFiles,
  ids: PlanIds,
  now: number,
): FileItems => {
  const known = new Map(plan.folders.map((folder) => [folder.path, folder.id]));
  const table = folderTable(ids.newFolderId, known);
  const ownItem = (file: PlannedFile): boolean =>
    !structural(file.path) &&
    !read.originals.has(file.sha) &&
    (!read.attached.has(file.sha) ||
      ITEM_ONLY_EXTENSIONS.has(extnamePath(file.path).toLowerCase()));
  const items = plan.files.filter(ownItem).map((file) => ({
    fields: fileItemFields(file, now),
    folderId: table.idOf(dirnamePath(file.path)),
    itemId: ids.newItemId(),
    path: file.path,
  }));
  return { folders: table.folders, items };
};
