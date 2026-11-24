import type { Root } from "mdast";
import type { TElement } from "platejs";

import { COVERS_DIR, isContainerKind, URL_ITEM_KINDS } from "@repo/contract/items/item-kind";
import type { ItemKind } from "@repo/contract/items/item-kind";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import { importedFields } from "@repo/contract/library/item-makes";
import type { ImportedFields, LibraryItemFields } from "@repo/contract/library/library-item";
import type { LibraryBlock, LibrarySection } from "@repo/contract/library/library-nodes";
import { settledAlone } from "@repo/editor/headless/formulas/pill-nodes";
import type { WikiResolve } from "@repo/editor/headless/markdown/remark-wiki-import";

import { frontmatterEnd, frontmatterYaml } from "@repo/editor/headless/markdown/frontmatter";
import { headlessEditor, parseMarkdownSections } from "@repo/editor/headless/codec/markdown-doc";
import { lfOnly, readMdast } from "@repo/editor/headless/markdown/md-read";
import type { MarkdownRead } from "@repo/editor/headless/markdown/md-read";
import { yamlCodeBlock } from "@repo/editor/headless/markdown/md-rules";
import { stringProp } from "@repo/editor/headless/node-props";

import { factsOf, itemFields, readFrontmatter, unheldYaml } from "./item-fields";
import { readBody, storedBlocks } from "./read-body";
import type { BodyPorts } from "./read-body";
import type { LibraryFile, LinkedItem } from "./read-blocks";

export interface FoundFile extends LibraryFile {
  readonly place: string;
}

export interface ImportPorts {
  readonly wiki: WikiResolve;
  readonly item: (key: string) => LinkedItem | null;
  readonly file: (url: string) => FoundFile | null;
  readonly newBlockId: () => string;
  readonly now: number;
}

export interface ItemSource {
  readonly text: string;
  readonly name: string;
}

export interface ImportedItem {
  readonly fields: ImportedFields;
  readonly blocks: readonly BodyBlock[];
  readonly leftOut: number;
}

type ItemImport =
  | { readonly ok: true; readonly item: ImportedItem }
  | Extract<MarkdownRead, { ok: false }>;

const imageUrl = (block: TElement | undefined) =>
  block?.type === "img" ? (stringProp(block, "url") ?? null) : null;

const under = (dir: string, path: string) => path.startsWith(`${dir}/`);

const originalKind = (kind: ItemKind) =>
  !URL_ITEM_KINDS.some((url) => url === kind) && kind !== "note" && !isContainerKind(kind);

interface HeldFiles {
  cover: string | null;
  original: { readonly sha: string; readonly name: string } | null;
}

const takeHeldFiles = (
  sections: { first: TElement[]; all: TElement[][] },
  kind: ItemKind,
  ports: ImportPorts,
) => {
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

const placed = (blocks: readonly LibraryBlock[], section: LibrarySection) =>
  blocks.map((block) => ({ block, section }));

const fieldsWith = (fields: LibraryItemFields, held: HeldFiles) =>
  importedFields({
    ...fields,
    coverSha: held.cover ?? (fields.kind === "image" ? (held.original?.sha ?? null) : null),
    originalName: held.original?.name ?? null,
    originalSha: held.original?.sha ?? null,
  });

export const importItem = (source: ItemSource, ports: ImportPorts) => {
  const text = lfOnly(source.text);
  const yaml = frontmatterYaml(text);
  const body = text.slice(frontmatterEnd(text) ?? 0);
  const read = parseMarkdownSections(body, headlessEditor(), { wiki: ports.wiki });

  if (!read.ok) {
    return read;
  }

  const front = readFrontmatter(yaml);
  const facts = factsOf(front);
  const settled = settledAlone([...read.sections.note, ...(read.sections.article ?? [])]);
  const note = settled.slice(0, read.sections.note.length);
  const article = settled.slice(read.sections.note.length);

  const held = takeHeldFiles(
    { all: [note, article], first: note.length > 0 ? note : article },
    facts.fields.kind,
    ports,
  );

  const unheld = unheldYaml(front);

  if (unheld !== null) {
    note.unshift(yamlCodeBlock(unheld));
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
  } satisfies ItemImport;
};

const PAGE_PORTS = { image: () => null, item: () => null };

export interface ArticleBlocks {
  readonly blocks: readonly LibraryBlock[];
  readonly refused: number;
}

export const articleBlocks = (tree: Root, newBlockId: () => string) => {
  const read = readMdast(headlessEditor(), tree);

  return read.ok ? storedBlocks(read.value, { links: PAGE_PORTS, newBlockId }) : null;
};

export const webNoteBlocks = (markdown: string, newBlockId: () => string) => {
  const read = readBody(markdown, { links: PAGE_PORTS, newBlockId });

  return (
    read.ok ? { blocks: read.blocks, refused: read.refused } : null
  ) satisfies ArticleBlocks | null;
};
