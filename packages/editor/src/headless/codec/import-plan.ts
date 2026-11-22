import {
  COVERS_DIR,
  fileKindOfMime,
  isBytesFolderPath,
  mediaTypeOfName,
  UNKNOWN_FILE_TYPE,
} from "@repo/contract/items/item-kind";
import type { FileKind } from "@repo/contract/items/item-kind";
import { fileFields, importedFields } from "@repo/contract/library/item-makes";
import { idSchema } from "@repo/contract/library/library-wire";
import { DEFAULT_ATTACHMENTS_FOLDER } from "@repo/contract/knowledge/asset-name";
import {
  docStem,
  isDocPath,
  isDotEntryPath,
  isOsLitterPath,
} from "@repo/contract/knowledge/doc-file";
import {
  basenamePath,
  dirnamePath,
  extnamePath,
  normalizePath,
  relativePath,
} from "@repo/contract/knowledge/folder-path";
import { frontmatterYaml } from "@repo/editor/headless/markdown/frontmatter";
import { lfOnly } from "@repo/editor/headless/markdown/md-read";
import type { MarkdownRefusal } from "@repo/editor/headless/markdown/md-read";
import type { WikiReach, WikiTarget } from "@repo/editor/headless/markdown/remark-wiki-import";

import { factsOf, readFrontmatter, titleOf } from "./item-fields";
import { importItem } from "./item-markdown";
import type { FoundFile, ImportedItem } from "./item-markdown";
import { mdLinkTarget, mdLinkUrl } from "./link-extract";
import { buildResolver } from "./link-resolve";
import type { TargetResolver } from "./link-resolve";
import type { LinkedItem } from "./read-blocks";

type ImportPathKind = "doc" | "file" | "skipped";

const ITEM_ONLY_EXTENSIONS = new Set([".canvas", ".base"]);

export const importPathKind = (raw: string) => {
  const path = normalizePath(raw);

  if (isOsLitterPath(path)) {
    return "skipped" as const;
  }

  if (isBytesFolderPath(path)) {
    return "file" as const;
  }

  if (path === "" || isDotEntryPath(path)) {
    return "skipped" as const;
  }

  return (isDocPath(path) ? "doc" : "file") satisfies ImportPathKind;
};

const isExportMark = (path: string) => path.startsWith(`${DEFAULT_ATTACHMENTS_FOLDER}/`);

const exportWrapper = (entries: readonly { readonly path: string }[]) => {
  const paths = entries.flatMap((entry) => (isOsLitterPath(entry.path) ? [] : [entry.path]));
  const first = paths.at(0) ?? "";
  const wrapper = first.slice(0, first.indexOf("/") + 1);

  return wrapper !== "" &&
    paths.every((path) => path.startsWith(wrapper)) &&
    paths.some((path) => isExportMark(path.slice(wrapper.length)))
    ? wrapper
    : null;
};

export const unwrapExport = <Entry extends { readonly path: string }>(
  entries: readonly Entry[],
) => {
  const wrapper = exportWrapper(entries);

  return wrapper === null
    ? entries
    : entries.map((entry) =>
        entry.path.startsWith(wrapper)
          ? { ...entry, path: entry.path.slice(wrapper.length) }
          : entry,
      );
};

export type ImportEntry =
  | { readonly kind: "doc"; readonly path: string; readonly text: string }
  | { readonly kind: "file"; readonly path: string; readonly sha: string };

export interface PlannedDoc {
  readonly path: string;
  readonly itemId: string;
  readonly title: string;
  readonly fileId: string | null;
  readonly aliases: readonly string[];
  readonly url: string | null;
}

interface PlannedFile {
  readonly path: string;
  readonly sha: string;
  readonly kind: FileKind;
}

export interface ImportPlan {
  readonly docs: readonly PlannedDoc[];
  readonly files: readonly PlannedFile[];
}

export interface PlanIds {
  readonly newItemId: (path: string) => string;
}

interface DocFront {
  readonly fileId: string | null;
  readonly title: string;
  readonly aliases: readonly string[];
  readonly url: string | null;
}

const docFront = (path: string, text: string) => {
  const facts = factsOf(readFrontmatter(frontmatterYaml(lfOnly(text))));

  return {
    aliases: facts.fields.aliases,
    fileId: facts.id,
    title: titleOf(facts, docStem(path)),
    url: facts.fields.url,
  } satisfies DocFront;
};

export const fileTypeOf = (path: string) => mediaTypeOfName(path) ?? UNKNOWN_FILE_TYPE;

export const planImport = (entries: readonly ImportEntry[], ids: PlanIds) => {
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

      default: {
        throw new Error(`unexpected ${String(entry satisfies never)}`);
      }
    }
  }

  return { docs, files } satisfies ImportPlan;
};

export interface PlanReader {
  readonly resolver: TargetResolver;
  readonly docs: ReadonlyMap<string, PlannedDoc>;
  readonly byId: ReadonlyMap<string, PlannedDoc>;
  readonly files: ReadonlyMap<string, PlannedFile>;
}

export const openPlan = (plan: ImportPlan) =>
  ({
    byId: new Map(
      plan.docs.flatMap(
        (doc) =>
          (doc.fileId === null
            ? [[doc.itemId, doc]]
            : [
                [doc.fileId.toLowerCase(), doc],
                [doc.itemId, doc],
              ]) satisfies [string, PlannedDoc][],
      ),
    ),
    docs: new Map(plan.docs.map((doc) => [doc.path, doc])),
    files: new Map(plan.files.map((file) => [file.path, file])),
    resolver: buildResolver(
      [...plan.docs.map((doc) => doc.path), ...plan.files.map((file) => file.path)],
      plan.docs.flatMap((doc) =>
        doc.aliases.map((alias) => [alias, doc.path] satisfies [string, string]),
      ),
    ),
  }) satisfies PlanReader;

export interface ReadPassPorts {
  readonly newBlockId: () => string;
  readonly now: number;
}

interface ImportedDoc {
  readonly doc: PlannedDoc;
  readonly item: ImportedItem;
}

type DocImport =
  | { readonly ok: true; readonly read: ImportedDoc }
  | { readonly ok: false; readonly path: string; readonly reason: MarkdownRefusal };

export const importPlannedDoc = (
  reader: PlanReader,
  doc: PlannedDoc,
  text: string,
  ports: ReadPassPorts,
) => {
  const { docs, files } = reader;
  const fromDir = dirnamePath(doc.path);

  const fileAt = (path: string) => {
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
    } satisfies FoundFile | null;
  };

  const reachedAt = (path: string | null, embed: boolean) => {
    const target = path === null ? undefined : docs.get(path);

    if (target !== undefined) {
      return { itemId: target.itemId, kind: "item", title: target.title } satisfies WikiReach;
    }

    const file = path === null || !embed ? null : fileAt(path);

    return (file === null ? null : { kind: "file", url: mdLinkUrl(file.path) }) satisfies WikiReach;
  };

  const wiki = (link: WikiTarget, embed: boolean) =>
    link.target === "" ? null : reachedAt(reader.resolver.resolveWiki(link.target), embed);

  const item = (key: string) => {
    const target = reader.byId.get(key) ?? reader.byId.get(key.toLowerCase());

    return (
      target === undefined ? null : { itemId: target.itemId, title: target.title }
    ) satisfies LinkedItem | null;
  };

  const file = (url: string) => {
    const target = mdLinkTarget(url);
    const path = target === null ? null : reader.resolver.resolveMd(target, doc.path);

    return path === null ? null : fileAt(path);
  };

  const read = importItem(
    { name: docStem(doc.path), text },
    { file, item, newBlockId: ports.newBlockId, now: ports.now, wiki },
  );

  return (
    read.ok
      ? { ok: true, read: { doc, item: read.item } }
      : { ok: false, path: doc.path, reason: read.reason }
  ) satisfies DocImport;
};

export interface ReadFiles {
  readonly attached: ReadonlySet<string>;
  readonly originals: ReadonlySet<string>;
}

const isCoverPath = (path: string) => path.startsWith(`${COVERS_DIR}/`);

const fileItemFields = (file: PlannedFile, now: number) =>
  importedFields(
    fileFields({
      parentId: null,
      mime: fileTypeOf(file.path),
      name: basenamePath(file.path),
      savedAt: now,
      sha: file.sha,
      tags: [],
    }),
  );

const fileItemFolder = (path: string) =>
  dirnamePath(isBytesFolderPath(path) ? dirnamePath(path) : path);

export const planFileItems = (plan: ImportPlan, read: ReadFiles, ids: PlanIds, now: number) => {
  const ownItem = (file: PlannedFile) =>
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
