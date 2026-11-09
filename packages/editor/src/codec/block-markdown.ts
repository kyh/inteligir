// One block as the markdown it reads as, and that markdown read back as one block: the text a stale
// write's three sides are merged over (`@repo/editor/stale-write`). A link keeps its item's id
// after its last pipe and a file its sha in its address, as the agent's view writes them
// (`item-view.ts`), so a merge names the same items and files it was handed. The text is read as
// it was written, so no Obsidian spelling is read out of it, and a block's `ref` stands beside its
// text rather than in it. A block whose markdown does not read back as itself has none.

import type { FileKind } from "@repo/contract/items/item-kind";
import { canonicalJson } from "@repo/contract/library/canonical-json";
import { storableBlockSchema } from "@repo/contract/library/library-nodes";
import type { LibraryBlock, LibraryNode } from "@repo/contract/library/library-nodes";

import { headlessEditor, parseMarkdown, serializeNote } from "@repo/editor/markdown/markdown-doc";

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

const WRITE_PORTS: WritePorts = { path: viewFilePath, target: () => null };

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
  // a merge reads back the link the block held, under the title it showed
  item: (key, shown) => ({ itemId: key, title: shown }),
});

// a block under another id
export const renamedBlock = (block: LibraryBlock, id: string): LibraryBlock => ({ ...block, id });

/** @internal */
export const blockMarkdown = (block: LibraryBlock): string =>
  serializeNote(headlessEditor(), writeBlocks([renamedBlock(block, block.id)], WRITE_PORTS));

// markdown read back as the one block it holds, under `id`; null when it holds none or several
export const blockFromMarkdown = (
  markdown: string,
  id: string,
  files: HeldFiles,
): LibraryBlock | null => {
  const converted = parseMarkdown(markdown);
  if (!converted.ok) {
    return null;
  }
  const [only, ...rest] = readBlocks(elementsOf(converted.value), readPorts(files));
  if (only === undefined || rest.length > 0) {
    return null;
  }
  const parsed = storableBlockSchema.safeParse(namedBlockJson({ element: only.element }, id));
  return parsed.success ? parsed.data : null;
};

// the block's markdown when it reads back as the block it is
export const faithfulMarkdown = (block: LibraryBlock, files: HeldFiles): string | null => {
  const markdown = blockMarkdown(block);
  const back = blockFromMarkdown(markdown, block.id, files);
  return back !== null && canonicalJson(back) === canonicalJson(block) ? markdown : null;
};
