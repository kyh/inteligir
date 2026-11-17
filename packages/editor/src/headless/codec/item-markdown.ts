// One markdown file as one item. Its fields are the frontmatter (`item-fields.ts`), its body the
// dialect, the page a fill read inside `:::article` after the person's note. The files an item
// holds whole sit where a vault puts them: a saved link's cover the body's first embed under
// `assets/covers/`, a file item's original its first embed of its kind.

import type { Root } from "mdast";
import type { TElement } from "platejs";

import { COVERS_DIR, URL_ITEM_KINDS } from "@repo/contract/items/item-kind";
import type { ItemKind } from "@repo/contract/items/item-kind";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import { importedFields } from "@repo/contract/library/item-makes";
import type { ImportedFields, LibraryItemFields } from "@repo/contract/library/library-item";
import type { LibraryBlock, LibrarySection } from "@repo/contract/library/library-nodes";
import { settledAlone } from "@repo/editor/headless/formulas/pill-nodes";
import type { WikiResolve } from "@repo/editor/headless/markdown/remark-wiki-import";

import { frontmatterEnd, frontmatterYaml } from "@repo/editor/headless/markdown/frontmatter";
import { headlessEditor, parseMarkdownSections } from "@repo/editor/headless/markdown/markdown-doc";
import { lfOnly, readMdast } from "@repo/editor/headless/markdown/md-read";
import type { MarkdownRead } from "@repo/editor/headless/markdown/md-read";
import { yamlCodeBlock } from "@repo/editor/headless/markdown/md-rules";
import { stringProp } from "@repo/editor/headless/node-props";

import { factsOf, itemFields, readFrontmatter } from "./item-fields";
import { readBody, storedBlocks } from "./read-body";
import type { BodyPorts } from "./read-body";
import type { LibraryFile, LinkedItem } from "./read-blocks";

// a file an import found, and where in the folder it sits
export interface FoundFile extends LibraryFile {
  readonly place: string;
}

export interface ImportPorts {
  // what an Obsidian `[[…]]` or `![[…]]` names: an item, a file the import holds, or nothing
  readonly wiki: WikiResolve;
  // the item a page link's key names, with its title; null for a key no item holds
  readonly item: (key: string) => LinkedItem | null;
  // the file a markdown image's or link's address names, from this file
  readonly file: (url: string) => FoundFile | null;
  readonly newBlockId: () => string;
  // the instant the import runs, unix milliseconds: what an item saved without `saved:` takes
  readonly now: number;
}

export interface ItemSource {
  readonly text: string;
  // the file's name, less its extension: the item's title unless its frontmatter names one
  readonly name: string;
}

export interface ImportedItem {
  readonly fields: ImportedFields;
  // in reading order
  readonly blocks: readonly BodyBlock[];
  // what the file held that the item cannot: each block no store takes
  readonly leftOut: number;
}

export type ItemImport =
  | { readonly ok: true; readonly item: ImportedItem }
  | Extract<MarkdownRead, { ok: false }>;

// a lone image block's address: the parse lifts every markdown image into a block of its own
const imageUrl = (block: TElement | undefined): string | null =>
  block?.type === "img" ? (stringProp(block, "url") ?? null) : null;

const under = (dir: string, path: string): boolean => path.startsWith(`${dir}/`);

const originalKind = (kind: ItemKind): boolean =>
  !URL_ITEM_KINDS.some((url) => url === kind) && kind !== "note";

interface HeldFiles {
  cover: string | null;
  // the original's bytes and the name it was found under
  original: { readonly sha: string; readonly name: string } | null;
}

// the body's structural files taken out of it: what a vault puts there, read back
const takeHeldFiles = (
  sections: { first: TElement[]; all: TElement[][] },
  kind: ItemKind,
  ports: ImportPorts,
): HeldFiles => {
  const held: HeldFiles = { cover: null, original: null };
  const firstUrl = imageUrl(sections.first[0]);
  const cover = firstUrl === null ? null : ports.file(firstUrl);
  if (cover?.kind === "image" && under(COVERS_DIR, cover.place)) {
    held.cover = cover.sha;
    sections.first.shift();
  }
  if (!originalKind(kind)) {
    return held;
  }
  for (const blocks of sections.all) {
    const index = blocks.findIndex((block) => {
      const url = imageUrl(block);
      const file = url === null ? null : ports.file(url);
      return file !== null && (kind === "file" || file.kind === kind);
    });
    const url = imageUrl(blocks[index]);
    const file = url === null ? null : ports.file(url);
    if (file !== null) {
      held.original = { name: file.name, sha: file.sha };
      blocks.splice(index, 1);
      return held;
    }
  }
  return held;
};

const placed = (blocks: readonly LibraryBlock[], section: LibrarySection): BodyBlock[] =>
  blocks.map((block) => ({ block, section }));

const fieldsWith = (fields: LibraryItemFields, held: HeldFiles): ImportedFields =>
  importedFields({
    ...fields,
    coverSha: held.cover ?? (fields.kind === "image" ? (held.original?.sha ?? null) : null),
    originalName: held.original?.name ?? null,
    originalSha: held.original?.sha ?? null,
  });

// one markdown file as its item: its frontmatter split off before the read, so a `---` its body
// opens with is the body's own; the note is what stands outside its top-level `:::article`
export const importItem = (source: ItemSource, ports: ImportPorts): ItemImport => {
  const text = lfOnly(source.text);
  const yaml = frontmatterYaml(text);
  const body = text.slice(frontmatterEnd(text) ?? 0);
  const read = parseMarkdownSections(body, headlessEditor(), { wiki: ports.wiki });
  if (!read.ok) {
    return read;
  }
  const front = readFrontmatter(yaml);
  const facts = factsOf(front);
  // a file's pills read each other across its note and its page, and no editor normalizes them
  const settled = settledAlone([...read.sections.note, ...(read.sections.article ?? [])]);
  const note = settled.slice(0, read.sections.note.length);
  const article = settled.slice(read.sections.note.length);
  const held = takeHeldFiles(
    { all: [note, article], first: note.length > 0 ? note : article },
    facts.fields.kind,
    ports,
  );
  if (front.kind === "invalid") {
    note.unshift(yamlCodeBlock(front.yaml));
  }
  const reading: BodyPorts = {
    links: { image: ports.file, item: ports.item },
    newBlockId: ports.newBlockId,
  };
  const noteBlocks = storedBlocks(note, reading);
  const pageBlocks = storedBlocks(article, reading);
  return {
    item: {
      blocks: [...placed(noteBlocks.blocks, "note"), ...placed(pageBlocks.blocks, "article")],
      fields: fieldsWith(itemFields(facts, source.name, ports.now), held),
      leftOut: noteBlocks.refused + pageBlocks.refused,
    },
    ok: true,
  };
};

// what a page names that the library could hold resolves to nothing: a page's links and images
// are addresses on the web
const PAGE_PORTS = { image: (): null => null, item: (): null => null };

export interface ArticleBlocks {
  readonly blocks: readonly LibraryBlock[];
  // the blocks no store takes, which the article goes without
  readonly refused: number;
}

// a page a reader read into a tree, as its item's article section, in order; null where the
// editor refuses the tree
export const articleBlocks = (tree: Root, newBlockId: () => string): ArticleBlocks | null => {
  const read = readMdast(headlessEditor(), tree);
  return read.ok ? storedBlocks(read.value, { links: PAGE_PORTS, newBlockId }) : null;
};

// markdown written outside the library, a bookmark's note in another app's export, as blocks: what
// it names is on the web as a page's is; null where the editor refuses the text
export const webNoteBlocks = (markdown: string, newBlockId: () => string): ArticleBlocks | null => {
  const read = readBody(markdown, { links: PAGE_PORTS, newBlockId });
  return read.ok ? { blocks: read.blocks, refused: read.refused } : null;
};
