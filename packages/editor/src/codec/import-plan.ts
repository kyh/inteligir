// A folder of markdown, this app's export or an Obsidian vault, read into the library in two
// passes, so no doc is held whole longer than its own reading. Pass one plans from every path
// and every doc's frontmatter: each doc's item and id, and every file's bytes. Pass two reads one
// doc at a time against the whole plan, resolving a `[[…]]` by the resolver's tiers (path, name,
// alias, `@repo/editor/knowledge/link-resolve`) and a page link by the `id:` its target's file
// carries. Last, every file no item names becomes an item of its own, so a bare file is a card of
// its own. A zip's paths reach all this with the folder an unpacked export was zipped under taken
// off (`unwrapExport`). Obsidian's settings (`.obsidian/`), every other dot-folder and what an
// operating system left are skipped, and a `.canvas` or a `.base` is always an item, never an
// attachment. An `AGENTS.md` is a note like any other, unless
// its writer finds it says what the library's rules say: filing rules reach the agent as the
// person's own instructions, so only the person writes them, and a zip is anyone's text.

import {
  COVERS_DIR,
  fileKindOfMime,
  isBytesFolderPath,
  mediaTypeOfName,
  UNKNOWN_FILE_TYPE,
} from "@repo/contract/items/item-kind";
import type { FileKind } from "@repo/contract/items/item-kind";
import { fileFields, importedFields } from "@repo/contract/library/item-makes";
import type { ImportedFields } from "@repo/contract/library/library-item";
import { idSchema } from "@repo/contract/library/library-wire";
import { DEFAULT_ATTACHMENTS_FOLDER } from "@repo/contract/knowledge/asset-name";
import {
  docStem,
  isDocPath,
  isDotEntryPath,
  isOsLitterPath,
} from "@repo/contract/knowledge/doc-file";
import { mdLinkTarget, mdLinkUrl } from "@repo/editor/knowledge/link-extract";
import { buildResolver } from "@repo/editor/knowledge/link-resolve";
import type { TargetResolver } from "@repo/editor/knowledge/link-resolve";
import {
  basenamePath,
  dirnamePath,
  extnamePath,
  normalizePath,
  relativePath,
} from "@repo/contract/knowledge/folder-path";
import { frontmatterYaml } from "@repo/editor/markdown/frontmatter";
import { lfOnly } from "@repo/editor/markdown/md-read";
import type { MarkdownRefusal } from "@repo/editor/markdown/md-read";
import type { WikiReach, WikiTarget } from "@repo/editor/markdown/remark-wiki-import";

import { factsOf, readFrontmatter, titleOf } from "./item-fields";
import { importItem } from "./item-markdown";
import type { FoundFile, ImportedItem } from "./item-markdown";
import type { LinkedItem } from "./read-blocks";

// what a path in the folder is to an import
export type ImportPathKind = "doc" | "file" | "skipped";

// Obsidian's whiteboard and its database view: files of their own, never shown inside a note
const ITEM_ONLY_EXTENSIONS = new Set([".canvas", ".base"]);

export const importPathKind = (raw: string): ImportPathKind => {
  const path = normalizePath(raw);
  if (isOsLitterPath(path)) {
    return "skipped";
  }
  if (isBytesFolderPath(path)) {
    return "file";
  }
  if (path === "" || isDotEntryPath(path)) {
    return "skipped";
  }
  return isDocPath(path) ? "doc" : "file";
};

// what marks a folder an export's rather than a person's: its kept files
const isExportMark = (path: string): boolean => path.startsWith(`${DEFAULT_ATTACHMENTS_FOLDER}/`);

const exportWrapper = (entries: readonly { readonly path: string }[]): string | null => {
  const paths = entries.map((entry) => entry.path).filter((path) => !isOsLitterPath(path));
  const first = paths.at(0) ?? "";
  const wrapper = first.slice(0, first.indexOf("/") + 1);
  return wrapper !== "" &&
    paths.every((path) => path.startsWith(wrapper)) &&
    paths.some((path) => isExportMark(path.slice(wrapper.length)))
    ? wrapper
    : null;
};

// A zip's whole listing with the folder an unpacked export was zipped under taken off, since a
// Mac's Compress keeps that folder and every mark of an export is read from the root. A folder
// holding no such mark stays, so an Obsidian vault's name is a folder in the library. It answers
// from the listing alone, so every reading of the same zip takes off the same folder.
export const unwrapExport = <Entry extends { readonly path: string }>(
  entries: readonly Entry[],
): readonly Entry[] => {
  const wrapper = exportWrapper(entries);
  return wrapper === null
    ? entries
    : entries.map((entry) =>
        entry.path.startsWith(wrapper)
          ? { ...entry, path: entry.path.slice(wrapper.length) }
          : entry,
      );
};

// one path of the folder, as pass one reads it: a doc's text, a file's bytes by sha
export type ImportEntry =
  | { readonly kind: "doc"; readonly path: string; readonly text: string }
  | { readonly kind: "file"; readonly path: string; readonly sha: string };

export interface PlannedDoc {
  readonly path: string;
  readonly itemId: string;
  readonly title: string;
  // the `id:` its frontmatter carries, which other docs' page links key by
  readonly fileId: string | null;
  readonly aliases: readonly string[];
  // the address its frontmatter names, by which the cell folds two saves of one page into one item
  readonly url: string | null;
}

interface PlannedFile {
  readonly path: string;
  readonly sha: string;
  readonly kind: FileKind;
}

// pass one's answer, plain data
export interface ImportPlan {
  readonly docs: readonly PlannedDoc[];
  readonly files: readonly PlannedFile[];
}

// the id of the item read from a path, which a reader that makes the same id for the same file
// keeps from landing a second copy when it reads that file again
export interface PlanIds {
  readonly newItemId: (path: string) => string;
}

interface DocFront {
  readonly fileId: string | null;
  readonly title: string;
  readonly aliases: readonly string[];
  readonly url: string | null;
}

const docFront = (path: string, text: string): DocFront => {
  const facts = factsOf(readFrontmatter(frontmatterYaml(lfOnly(text))));
  return {
    aliases: facts.fields.aliases,
    fileId: facts.id,
    title: titleOf(facts, docStem(path)),
    url: facts.fields.url,
  };
};

// the type an import keeps a file's bytes under, its name's, which the file's item takes its kind
// from as an upload's does
export const fileTypeOf = (path: string): string => mediaTypeOfName(path) ?? UNKNOWN_FILE_TYPE;

// pass one: every path planned, an item id minted for each doc (its own uuid kept when it has an
// unused one), and the resolver every doc's links are read through
export const planImport = (entries: readonly ImportEntry[], ids: PlanIds): ImportPlan => {
  const docs: PlannedDoc[] = [];
  const files: PlannedFile[] = [];
  const usedIds = new Set<string>();
  for (const entry of entries) {
    const path = normalizePath(entry.path);
    switch (entry.kind) {
      case "file": {
        files.push({ kind: fileKindOfMime(fileTypeOf(path)), path, sha: entry.sha });
        break;
      }
      case "doc": {
        const front = docFront(path, entry.text);
        const own =
          front.fileId !== null && idSchema.safeParse(front.fileId).success
            ? front.fileId.toLowerCase()
            : null;
        const itemId = own !== null && !usedIds.has(own) ? own : ids.newItemId(path);
        usedIds.add(itemId);
        docs.push({
          aliases: front.aliases,
          fileId: front.fileId,
          itemId,
          path,
          title: front.title,
          url: front.url,
        });
        break;
      }
      // no default
    }
  }
  return { docs, files };
};

// a plan opened for pass two: its lookups and its resolver, built once for every doc it reads
export interface PlanReader {
  readonly resolver: TargetResolver;
  readonly docs: ReadonlyMap<string, PlannedDoc>;
  // each doc by the item id the plan gave it and by the `id:` its file carries, lower-cased
  readonly byId: ReadonlyMap<string, PlannedDoc>;
  readonly files: ReadonlyMap<string, PlannedFile>;
}

export const openPlan = (plan: ImportPlan): PlanReader => ({
  byId: new Map(
    plan.docs.flatMap((doc): [string, PlannedDoc][] =>
      doc.fileId === null
        ? [[doc.itemId, doc]]
        : [
            [doc.fileId.toLowerCase(), doc],
            [doc.itemId, doc],
          ],
    ),
  ),
  docs: new Map(plan.docs.map((doc) => [doc.path, doc])),
  files: new Map(plan.files.map((file) => [file.path, file])),
  resolver: buildResolver(
    [...plan.docs.map((doc) => doc.path), ...plan.files.map((file) => file.path)],
    plan.docs.flatMap((doc) => doc.aliases.map((alias): [string, string] => [alias, doc.path])),
  ),
});

export interface ReadPassPorts {
  readonly newBlockId: () => string;
  readonly now: number;
}

interface ImportedDoc {
  readonly doc: PlannedDoc;
  readonly item: ImportedItem;
}

export type DocImport =
  | { readonly ok: true; readonly read: ImportedDoc }
  | { readonly ok: false; readonly path: string; readonly reason: MarkdownRefusal };

// pass two: one doc read against the whole plan
export const importPlannedDoc = (
  reader: PlanReader,
  doc: PlannedDoc,
  text: string,
  ports: ReadPassPorts,
): DocImport => {
  const { docs, files } = reader;
  const fromDir = dirnamePath(doc.path);
  const fileAt = (path: string): FoundFile | null => {
    const file = files.get(path);
    if (file === undefined) {
      return null;
    }
    return {
      kind: file.kind,
      name: basenamePath(path),
      path: relativePath(fromDir, path),
      place: path,
      sha: file.sha,
    };
  };
  const reachedAt = (path: string | null, embed: boolean): WikiReach => {
    const target = path === null ? undefined : docs.get(path);
    if (target !== undefined) {
      return { itemId: target.itemId, kind: "item", title: target.title };
    }
    const file = path === null || !embed ? null : fileAt(path);
    return file === null ? null : { kind: "file", url: mdLinkUrl(file.path) };
  };
  // an anchor alone names a place in this note, which a page link cannot
  const wiki = (link: WikiTarget, embed: boolean): WikiReach =>
    link.target === "" ? null : reachedAt(reader.resolver.resolveWiki(link.target), embed);
  // a page link names a planned item by its id: one a `[[…]]` resolved to, or the one this app's
  // export wrote, which its file carries
  const item = (key: string): LinkedItem | null => {
    const target = reader.byId.get(key) ?? reader.byId.get(key.toLowerCase());
    return target === undefined ? null : { itemId: target.itemId, title: target.title };
  };
  const file = (url: string): FoundFile | null => {
    const target = mdLinkTarget(url);
    const path = target === null ? null : reader.resolver.resolveMd(target, doc.path);
    return path === null ? null : fileAt(path);
  };
  const read = importItem(
    { name: docStem(doc.path), text },
    { file, item, newBlockId: ports.newBlockId, now: ports.now, wiki },
  );
  return read.ok
    ? { ok: true, read: { doc, item: read.item } }
    : { ok: false, path: doc.path, reason: read.reason };
};

interface PlannedFileItem {
  readonly itemId: string;
  // the folder's path in the zip, "" at its root
  readonly folderPath: string;
  readonly fields: ImportedFields;
}

// what the library's items name of the files once pass two has run: every file, and those an item
// holds as its own original (a wrapper of a file item, as an export writes one)
export interface ReadFiles {
  readonly attached: ReadonlySet<string>;
  readonly originals: ReadonlySet<string>;
}

// a cover, where an export puts one
const isCoverPath = (path: string): boolean => path.startsWith(`${COVERS_DIR}/`);

const fileItemFields = (file: PlannedFile, now: number): ImportedFields =>
  importedFields(
    fileFields({
      folderId: null,
      mime: fileTypeOf(file.path),
      name: basenamePath(file.path),
      savedAt: now,
      sha: file.sha,
      tags: [],
    }),
  );

// the folder a file's item stands in: a folder of a file's bytes is named for no person to read,
// so its file stands in the folder above
const fileItemFolder = (path: string): string =>
  dirnamePath(isBytesFolderPath(path) ? dirnamePath(path) : path);

// pass three: every file no item names, and every `.canvas` and `.base` no item holds as its
// original, an item of its own in its folder; a cover no item holds is no card, since it is part
// of an item
export const planFileItems = (
  plan: ImportPlan,
  read: ReadFiles,
  ids: PlanIds,
  now: number,
): PlannedFileItem[] => {
  const ownItem = (file: PlannedFile): boolean =>
    !isCoverPath(file.path) &&
    !read.originals.has(file.sha) &&
    (!read.attached.has(file.sha) ||
      ITEM_ONLY_EXTENSIONS.has(extnamePath(file.path).toLowerCase()));
  return plan.files.filter(ownItem).map((file) => ({
    fields: fileItemFields(file, now),
    folderPath: fileItemFolder(file.path),
    itemId: ids.newItemId(file.path),
  }));
};
