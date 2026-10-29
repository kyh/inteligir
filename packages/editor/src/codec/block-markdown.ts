// One block as the markdown it reads as, and that markdown read back as one block: the text a stale
// write's three sides are merged over (`@repo/editor/stale-write`). A link keeps its item's id
// after its last pipe and a file its sha in its address, as the agent's view writes them
// (`item-view.ts`), so a merge names the same items and files it was handed. The text is read as
// it was written, so no Obsidian spelling is read out of it, and a block's `ref` stands beside its
// text rather than in it. A block whose markdown does not read back as itself has none: the
// editor's nested ids aside, which no markdown holds.

import type { FileKind } from "@repo/notes/items/item-kind";
import { canonicalJson } from "@repo/notes/library/canonical-json";
import type { JsonValue } from "@repo/notes/library/canonical-json";
import { storableBlockSchema } from "@repo/notes/library/library-nodes";
import type { LibraryBlock, LibraryNode } from "@repo/notes/library/library-nodes";
import { isUuidWikiAlias } from "@repo/notes/markdown/remark-wiki-link";

import { headlessEditor, serializeNote } from "@repo/editor/markdown/markdown-doc";
import { mdToSlate } from "@repo/editor/markdown/md-to-slate";

import { viewFileAt, viewFilePath } from "./item-view";
import { namedBlockJson, readBlocks } from "./read-blocks";
import type { ReadPorts } from "./read-blocks";
import { elementsOf } from "./read-markdown";
import { writeBlocks } from "./write-blocks";
import type { WritePorts } from "./write-blocks";

interface HeldFile {
  readonly kind: FileKind;
  readonly name: string;
}

// the files blocks name by their bytes, so an address their markdown writes names one back
export type HeldFiles = ReadonlyMap<string, HeldFile>;

const WRITE_PORTS: WritePorts = { path: viewFilePath, target: () => null, withIds: true };

const fileOf = (node: LibraryNode): readonly [string, HeldFile] | null => {
  if ("text" in node) {
    return null;
  }
  switch (node.type) {
    case "img": {
      return node.sha === undefined ? null : [node.sha, { kind: "image", name: node.sha }];
    }
    case "video": {
      return node.sha === undefined ? null : [node.sha, { kind: "video", name: node.sha }];
    }
    case "file": {
      return node.sha === undefined
        ? null
        : [node.sha, { kind: "file", name: node.name ?? node.sha }];
    }
    default: {
      return null;
    }
  }
};

export const filesIn = (blocks: readonly LibraryBlock[]): HeldFiles => {
  const files = new Map<string, HeldFile>();
  const visit = (node: LibraryNode): void => {
    const file = fileOf(node);
    if (file !== null) {
      files.set(file[0], file[1]);
    }
    if (!("text" in node)) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };
  for (const block of blocks) {
    visit(block);
  }
  return files;
};

const readPorts = (files: HeldFiles): ReadPorts => ({
  image: (url) => {
    const at = viewFileAt(url);
    const held = at === null ? undefined : files.get(at.sha);
    return at === null || held === undefined
      ? null
      : { kind: held.kind, name: at.name ?? held.name, path: url, sha: at.sha };
  },
  wiki: (link) =>
    link.alias !== undefined && isUuidWikiAlias(link.alias)
      ? { itemId: link.alias, kind: "item", title: link.target }
      : { kind: "title", title: link.target },
});

// a block under another id and `ref`
export const renamedBlock = (block: LibraryBlock, id: string, ref?: string): LibraryBlock => ({
  ...block,
  id,
  ref,
});

export const blockMarkdown = (block: LibraryBlock): string =>
  serializeNote(headlessEditor(), writeBlocks([renamedBlock(block, block.id)], WRITE_PORTS));

// markdown read back as the one block it holds, under `id`; null when it holds none or several
export const blockFromMarkdown = (
  markdown: string,
  id: string,
  files: HeldFiles,
): LibraryBlock | null => {
  const converted = mdToSlate(headlessEditor(), markdown);
  if (!converted.ok) {
    return null;
  }
  const { blocks } = readBlocks(elementsOf(converted.nodes), readPorts(files), null);
  const [only, ...rest] = blocks;
  if (only === undefined || rest.length > 0) {
    return null;
  }
  const parsed = storableBlockSchema.safeParse(
    namedBlockJson({ element: only.element, ref: null }, id),
  );
  return parsed.success ? parsed.data : null;
};

// a node without the id the editor mints for an element below the top level, which no markdown
// holds; canonical JSON leaves an undefined member out
const withoutNestedIds = (node: LibraryNode): JsonValue =>
  "text" in node ? node : { ...node, children: node.children.map(withoutNestedIds), id: undefined };

const contentKey = (block: LibraryBlock): string =>
  canonicalJson({ ...block, children: block.children.map(withoutNestedIds), ref: undefined });

// the block's markdown when it reads back as the block it is, its `ref` and nested ids aside
export const faithfulMarkdown = (block: LibraryBlock, files: HeldFiles): string | null => {
  const markdown = blockMarkdown(block);
  const back = blockFromMarkdown(markdown, block.id, files);
  return back !== null && contentKey(back) === contentKey(block) ? markdown : null;
};
