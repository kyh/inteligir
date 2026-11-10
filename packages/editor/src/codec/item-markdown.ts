// One item as one markdown file, both ways. Its fields are the frontmatter
// (`item-fields.ts`), its body the dialect, the page a fill read inside `:::article` after the
// person's note. The files an item holds whole sit where an export puts them: a saved link's cover the body's first embed under `assets/covers/`, a file item's
// original its first embed of its kind.

import type { TElement } from "platejs";

import { COVERS_DIR, URL_ITEM_KINDS } from "@repo/contract/items/item-kind";
import type { ItemKind } from "@repo/contract/items/item-kind";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import type { LibraryBlock, LibrarySection } from "@repo/contract/library/library-nodes";
import type { WikiResolve } from "@repo/editor/markdown/remark-wiki-import";

import { frontmatterEnd, frontmatterYaml } from "@repo/editor/markdown/frontmatter";
import {
  headlessEditor,
  parseMarkdown,
  parseMarkdownSections,
  serializeNote,
} from "@repo/editor/markdown/markdown-doc";
import { lfOnly } from "@repo/editor/markdown/md-read";
import { ARTICLE_SECTION_KEY, yamlCodeBlock } from "@repo/editor/markdown/md-rules";
import { stringProp } from "@repo/editor/node-props";

import { readFrontmatter, writeFrontmatter } from "./item-fields";
import type { FileFields } from "./item-fields";
import { nameDrafts } from "./name-blocks";
import { readBlocks } from "./read-blocks";
import { elementsOf } from "./read-markdown";
import type { LibraryFile, LinkedItem } from "./read-blocks";
import { leaf } from "./slate-leaves";
import { writeBlocks } from "./write-blocks";
import type { WritePorts } from "./write-blocks";

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

export type ImportedFields = Omit<LibraryItemFields, "deletedAt" | "folderId">;

export interface ImportedItem {
  readonly fields: ImportedFields;
  // in reading order
  readonly blocks: readonly BodyBlock[];
  // what the file held that the item cannot: each block no store takes
  readonly leftOut: number;
}

export type ItemImport =
  | { readonly ok: true; readonly item: ImportedItem }
  | { readonly ok: false; readonly reason: "too-deep" };

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

// the body's structural files taken out of it: what an export puts there, read back
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

const fieldsWith = (fields: FileFields, held: HeldFiles): ImportedFields => ({
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
    return { ok: false, reason: "too-deep" };
  }
  const front = readFrontmatter(yaml, source.name, ports.now);
  const note = [...read.sections.note];
  const article = [...(read.sections.article ?? [])];
  const held = takeHeldFiles(
    { all: [note, article], first: note.length > 0 ? note : article },
    front.fields.kind,
    ports,
  );
  if (front.invalidYaml !== null) {
    note.unshift(yamlCodeBlock(front.invalidYaml));
  }
  const readPorts = {
    image: (url: string): LibraryFile | null => ports.file(url),
    item: ports.item,
  };
  const noteBlocks = nameDrafts(readBlocks(note, readPorts), ports.newBlockId);
  const pageBlocks = nameDrafts(readBlocks(article, readPorts), ports.newBlockId);
  return {
    item: {
      blocks: [...placed(noteBlocks.blocks, "note"), ...placed(pageBlocks.blocks, "article")],
      fields: fieldsWith(front.fields, held),
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
}

// a page a fill read (the reader's canonical markdown) as its item's article section, in order
export const articleBlocks = (markdown: string, newBlockId: () => string): ArticleBlocks | null => {
  const converted = parseMarkdown(markdown);
  if (!converted.ok) {
    return null;
  }
  const drafts = readBlocks(elementsOf(converted.value), PAGE_PORTS);
  const named = nameDrafts(drafts, newBlockId);
  return { blocks: named.blocks };
};

/** @internal */
export interface ExportItem {
  readonly id: string;
  readonly fields: LibraryItemFields;
  // in reading order
  readonly blocks: readonly BodyBlock[];
}

// a file the item holds whole, by its role: an original by the name it was saved under too, null
// where none came with it
/** @internal */
export type HeldFile =
  | { readonly role: "cover"; readonly sha: string }
  | { readonly role: "original"; readonly sha: string; readonly name: string | null };

/** @internal */
export interface ExportPorts extends WritePorts {
  // where a file the item holds whole is written
  readonly held: (file: HeldFile) => string;
}

/** @internal */
export interface ExportedItem {
  readonly text: string;
}

const heldImage = (url: string): TElement => ({
  caption: [leaf("", {})],
  children: [leaf("", {})],
  type: "img",
  url,
});

// one item as one markdown file; `title` is written into the frontmatter when the file's name
// cannot carry it. No surface writes one: the codec's suites hold every import to this, its inverse
/** @internal */
export const exportItem = (
  item: ExportItem,
  ports: ExportPorts,
  title: string | null,
): ExportedItem => {
  const of = (section: LibrarySection): LibraryBlock[] =>
    item.blocks.filter((body) => body.section === section).map((body) => body.block);
  const note = writeBlocks(of("note"), ports);
  const article = writeBlocks(of("article"), ports);
  const { fields } = item;
  const head: TElement[] = [];
  const ownCover = fields.coverSha !== null && fields.coverSha !== fields.originalSha;
  if (fields.coverSha !== null && (ownCover || fields.kind !== "image")) {
    head.push(heldImage(ports.held({ role: "cover", sha: fields.coverSha })));
  }
  if (fields.originalSha !== null) {
    head.push(
      heldImage(
        ports.held({ name: fields.originalName, role: "original", sha: fields.originalSha }),
      ),
    );
  }
  const body: TElement[] =
    article.length > 0
      ? [...head, ...note, { children: article, type: ARTICLE_SECTION_KEY }]
      : [...head, ...note];
  const markdown = body.length === 0 ? "" : `${serializeNote(headlessEditor(), body).trimEnd()}\n`;
  const yaml = writeFrontmatter(fields, item.id, title);
  const separator = markdown === "" ? "" : "\n";
  return { text: `---\n${yaml}\n---\n${separator}${markdown}` };
};
