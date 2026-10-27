// One item as one markdown file in today's vault format, both ways. Its fields are the frontmatter
// (`item-fields.ts`), its body the dialect, the page a fill read inside `:::article` after the
// person's note, and its highlights the markers in the body beside the item's
// `.inteligir/annotations/<id>.json`. The files an item holds whole sit where the vault's
// writers put them: a saved link's cover the body's first embed under `assets/covers/`, its page
// copy the last line's `[Copy of the page]` link, a file item's original its first embed of its
// kind. A file from before the article section was written reads a read link's whole body as the
// page, which a Refresh replaces, as the vault's Refresh did.

import type { Root, RootContent } from "mdast";
import { ElementApi } from "platejs";
import type { Descendant, TElement } from "platejs";

import {
  parseAnnotationStore,
  serializeAnnotationStore,
} from "@repo/notes/annotations/store-schema";
import type { AnnotationStore } from "@repo/notes/annotations/store-schema";
import { COVERS_DIR, PAGES_DIR, URL_ITEM_KINDS } from "@repo/notes/items/item-kind";
import type { ItemKind } from "@repo/notes/items/item-kind";
import { orderedBlocks } from "@repo/notes/library/block-ops";
import type { StoredBlock } from "@repo/notes/library/block-ops";
import { ordsBetween } from "@repo/notes/library/block-order";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import type { LibraryBlock, LibrarySection } from "@repo/notes/library/library-nodes";
import { parseMdast } from "@repo/notes/markdown/parse";
import type { WikiBody } from "@repo/notes/markdown/remark-wiki-link";

import { headlessEditor, serializeNote } from "@repo/editor/markdown/markdown-doc";
import { ARTICLE_SECTION_KEY } from "@repo/editor/markdown/md-rules";
import { mdToSlate, rootToSlate } from "@repo/editor/markdown/md-to-slate";
import { stringProp } from "@repo/editor/node-props";

import { readFrontmatter, writeFrontmatter } from "./item-fields";
import type { FileFields } from "./item-fields";
import { nameDrafts } from "./name-blocks";
import type { RefusedBlock } from "./name-blocks";
import { readBlocks } from "./read-blocks";
import { elementsOf, embedFiles, settled } from "./read-markdown";
import type { LibraryFile, Reached, ReadHighlight } from "./read-blocks";
import { isText, leaf } from "./slate-leaves";
import { writeBlocks } from "./write-blocks";
import type { WritePorts } from "./write-blocks";

// a file an import found, and where in the folder it sits
export interface FoundFile extends LibraryFile {
  readonly place: string;
}

export interface ImportPorts {
  readonly wiki: (link: WikiBody, embed: boolean) => Reached;
  // the file a markdown image's or link's address names, from this file
  readonly file: (url: string) => FoundFile | null;
  readonly newBlockId: () => string;
  readonly newAnnotationId: () => string;
  // the instant the import runs, unix milliseconds: what an item saved without `saved:` takes, and
  // when its Obsidian highlights were made
  readonly now: number;
}

export interface ItemSource {
  readonly text: string;
  // the file's name, less its extension: the item's title unless its frontmatter names one
  readonly name: string;
  // the item's `.inteligir/annotations/<id>.json`, as written
  readonly annotations: string | null;
}

// a block in its place, as an insert lands it
export interface PlacedBlock {
  readonly block: LibraryBlock;
  readonly ord: string;
  readonly section: LibrarySection;
}

export type ImportedFields = Omit<LibraryItemFields, "deletedAt" | "folderId">;

export interface ImportedItem {
  // the `id:` the file carried, which other files' `[[Title|uuid]]` and its store key by
  readonly fileId: string | null;
  readonly fields: ImportedFields;
  readonly blocks: readonly PlacedBlock[];
  readonly annotations: AnnotationStore;
  readonly refused: readonly RefusedBlock[];
  // why the highlights' store could not be read; its highlights were left out
  readonly annotationsError: string | null;
}

export type ItemImport =
  | { readonly ok: true; readonly item: ImportedItem }
  | { readonly ok: false; readonly reason: "too-deep" };

const COPY_LINK_TEXT = "Copy of the page";

interface Parts {
  readonly yaml: string | null;
  // the root's children before an `:::article`, inside it, and after it
  readonly before: RootContent[];
  readonly article: RootContent[] | null;
  readonly after: RootContent[];
}

const partsOf = (root: Root): Parts => {
  let yaml: string | null = null;
  const before: RootContent[] = [];
  const after: RootContent[] = [];
  let article: RootContent[] | null = null;
  for (const child of root.children) {
    if (child.type === "yaml") {
      yaml ??= child.value;
    } else if (child.type === "articleSection") {
      article = [...(article ?? []), ...child.children];
    } else {
      (article === null ? before : after).push(child);
    }
  }
  return { after, article, before, yaml };
};

const isElement = (node: Descendant): node is TElement => ElementApi.isElement(node);

// a lone image block's address: the parse lifts every markdown image into a block of its own
const imageUrl = (block: TElement | undefined): string | null =>
  block?.type === "img" ? (stringProp(block, "url") ?? null) : null;

// a paragraph holding only `[Copy of the page](…)`
const copyLinkUrl = (block: TElement | undefined): string | null => {
  const inner =
    block?.type === "p"
      ? block.children.filter((child) => !isText(child) || child.text.trim() !== "")
      : [];
  const [link, ...rest] = inner;
  if (link === undefined || rest.length > 0 || !isElement(link) || link.type !== "a") {
    return null;
  }
  const [label, ...more] = link.children;
  return more.length === 0 && label !== undefined && isText(label) && label.text === COPY_LINK_TEXT
    ? (stringProp(link, "url") ?? null)
    : null;
};

const under = (dir: string, path: string): boolean => path.startsWith(`${dir}/`);

const isUrlKind = (kind: ItemKind): boolean => URL_ITEM_KINDS.some((url) => url === kind);

const originalKind = (kind: ItemKind): boolean =>
  !URL_ITEM_KINDS.some((url) => url === kind) && kind !== "note";

interface HeldFiles {
  cover: string | null;
  original: string | null;
  copy: string | null;
}

// the body's structural files taken out of it: what the vault's writers put there, read back
const takeHeldFiles = (
  sections: { first: TElement[]; last: TElement[]; all: TElement[][] },
  kind: ItemKind,
  ports: ImportPorts,
): HeldFiles => {
  const held: HeldFiles = { copy: null, cover: null, original: null };
  const firstUrl = imageUrl(sections.first[0]);
  const cover = firstUrl === null ? null : ports.file(firstUrl);
  if (cover !== null && cover.kind === "image" && under(COVERS_DIR, cover.place)) {
    held.cover = cover.sha;
    sections.first.shift();
  }
  const lastUrl = copyLinkUrl(sections.last.at(-1));
  const copy = lastUrl === null ? null : ports.file(lastUrl);
  if (copy !== null && under(PAGES_DIR, copy.place) && copy.place.toLowerCase().endsWith(".html")) {
    held.copy = copy.sha;
    sections.last.pop();
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
      held.original = file.sha;
      blocks.splice(index, 1);
      return held;
    }
  }
  return held;
};

// a block that is not YAML, kept where the person can see and mend it
const yamlBlock = (yaml: string): TElement => ({
  children: yaml.split(/\r?\n/u).map((line) => ({ children: [leaf(line, {})], type: "code_line" })),
  lang: "yaml",
  type: "code_block",
});

const placed = (blocks: readonly LibraryBlock[], section: LibrarySection): PlacedBlock[] => {
  const ords = blocks.length === 0 ? [] : ordsBetween(null, null, blocks.length);
  return blocks.map((block, index) => ({ block, ord: ords[index] ?? "a0", section }));
};

const highlightEntries = (highlights: readonly ReadHighlight[], now: number): AnnotationStore => {
  const seconds = Math.floor(now / 1000);
  const store: AnnotationStore = {};
  for (const { id, quote } of highlights) {
    store[id] = { createdAt: seconds, quote, source: "user", text: "", updatedAt: seconds };
  }
  return store;
};

const fieldsWith = (fields: FileFields, held: HeldFiles): ImportedFields => ({
  ...fields,
  copySha: held.copy,
  coverSha: held.cover ?? (fields.kind === "image" ? held.original : null),
  originalSha: held.original,
});

interface SectionValues {
  readonly before: TElement[];
  readonly article: TElement[];
  readonly after: TElement[];
}

const sectionValues = (parts: Parts): SectionValues | null => {
  const editor = headlessEditor();
  const values: TElement[][] = [];
  for (const children of [parts.before, parts.article ?? [], parts.after]) {
    const converted = rootToSlate(editor, { children, type: "root" });
    if (!converted.ok) {
      return null;
    }
    values.push(elementsOf(converted.nodes));
  }
  const [before = [], article = [], after = []] = values;
  return { after, article, before };
};

interface ReadAnnotations {
  readonly annotations: AnnotationStore;
  readonly error: string | null;
}

// the store the file's highlights were kept in, and the bare highlights its `==x==` made
const annotationsOf = (
  written: string | null,
  highlights: readonly ReadHighlight[],
  now: number,
): ReadAnnotations => {
  const store = written === null ? null : parseAnnotationStore(written);
  const kept = store?.ok === true ? store.store : {};
  return {
    annotations: { ...kept, ...highlightEntries(highlights, now) },
    error: store?.ok === false ? store.error : null,
  };
};

// one markdown file as its item
export const importItem = (source: ItemSource, ports: ImportPorts): ItemImport => {
  let parts: Parts;
  try {
    parts = partsOf(parseMdast(source.text).root);
  } catch (error) {
    if (error instanceof RangeError) {
      return { ok: false, reason: "too-deep" };
    }
    throw error;
  }
  const values = sectionValues(parts);
  if (values === null) {
    return { ok: false, reason: "too-deep" };
  }
  const front = readFrontmatter(parts.yaml, source.name, ports.now);
  const { after, article, before } = values;
  const order = [before, article, after].filter((blocks) => blocks.length > 0);
  const held = takeHeldFiles(
    { all: [before, article, after], first: order[0] ?? before, last: order.at(-1) ?? before },
    front.fields.kind,
    ports,
  );
  // a read link from before the article section: its body is the page
  const readPage =
    parts.article === null && isUrlKind(front.fields.kind) && front.fields.fetchState === "filled";
  const note = readPage ? [] : [...before, ...after];
  if (front.invalidYaml !== null) {
    note.unshift(yamlBlock(front.invalidYaml));
  }
  const readPorts = {
    image: (url: string): LibraryFile | null => ports.file(url),
    wiki: ports.wiki,
  };
  const read = (value: TElement[]): TElement[] => settled(elementsOf(embedFiles(value, readPorts)));
  const noteRead = readBlocks(read(note), readPorts, ports);
  const pageRead = readBlocks(read(readPage ? before : article), readPorts, null);
  const noteBlocks = nameDrafts(noteRead.blocks, ports.newBlockId);
  const pageBlocks = nameDrafts(pageRead.blocks, ports.newBlockId);
  const highlights = annotationsOf(source.annotations, noteRead.highlights, ports.now);
  return {
    item: {
      annotations: highlights.annotations,
      annotationsError: highlights.error,
      blocks: [...placed(noteBlocks.blocks, "note"), ...placed(pageBlocks.blocks, "article")],
      fields: fieldsWith(front.fields, held),
      fileId: front.id,
      refused: [...noteBlocks.refused, ...pageBlocks.refused],
    },
    ok: true,
  };
};

// what a page names that the library could hold resolves to nothing: a page's links and images
// are addresses on the web
const PAGE_PORTS = { image: (): null => null, wiki: (): null => null };

export interface ArticleBlocks {
  readonly blocks: readonly PlacedBlock[];
  readonly refused: readonly RefusedBlock[];
}

// a page a fill read (the reader's canonical markdown) as its item's article section, keys minted
// apart from the note's, so a fill never threads its blocks through the person's
export const articleBlocks = (markdown: string, newBlockId: () => string): ArticleBlocks | null => {
  const converted = mdToSlate(headlessEditor(), markdown);
  if (!converted.ok) {
    return null;
  }
  const drafts = readBlocks(settled(elementsOf(converted.nodes)), PAGE_PORTS, null);
  const named = nameDrafts(drafts.blocks, newBlockId);
  return { blocks: placed(named.blocks, "article"), refused: named.refused };
};

export interface ExportItem {
  readonly id: string;
  readonly fields: LibraryItemFields;
  readonly blocks: ReadonlyMap<string, StoredBlock>;
  readonly annotations: AnnotationStore;
}

export type HeldRole = "cover" | "original" | "copy";

export interface ExportPorts extends WritePorts {
  // where a file the item holds whole is written
  readonly held: (sha: string, role: HeldRole) => string;
}

export interface ExportedItem {
  readonly text: string;
  // its highlights' store, null when it holds none
  readonly annotations: string | null;
}

const heldImage = (url: string): TElement => ({
  caption: [leaf("", {})],
  children: [leaf("", {})],
  type: "img",
  url,
});

const heldCopy = (url: string): TElement => ({
  children: [{ children: [leaf(COPY_LINK_TEXT, {})], type: "a", url }],
  type: "p",
});

// one item as one markdown file; `title` is written into the frontmatter when the file's name
// cannot carry it
export const exportItem = (
  item: ExportItem,
  ports: ExportPorts,
  title: string | null,
): ExportedItem => {
  const blocks = orderedBlocks(item.blocks);
  const of = (section: LibrarySection): LibraryBlock[] =>
    blocks.filter((stored) => stored.section === section).map((stored) => stored.block);
  const note = writeBlocks(of("note"), ports);
  const article = writeBlocks(of("article"), ports);
  const { fields } = item;
  const head: TElement[] = [];
  const ownCover = fields.coverSha !== null && fields.coverSha !== fields.originalSha;
  if (fields.coverSha !== null && (ownCover || fields.kind !== "image")) {
    head.push(heldImage(ports.held(fields.coverSha, "cover")));
  }
  if (fields.originalSha !== null) {
    head.push(heldImage(ports.held(fields.originalSha, "original")));
  }
  // a read link's note beside no page keeps the section, so the note does not read back as the page
  const keepsSection =
    article.length > 0 ||
    (note.length > 0 && isUrlKind(fields.kind) && fields.fetchState === "filled");
  const body: TElement[] = keepsSection
    ? [...head, ...note, { children: article, type: ARTICLE_SECTION_KEY }]
    : [...head, ...note];
  if (fields.copySha !== null) {
    body.push(heldCopy(ports.held(fields.copySha, "copy")));
  }
  const markdown = body.length === 0 ? "" : `${serializeNote(headlessEditor(), body).trimEnd()}\n`;
  const yaml = writeFrontmatter(fields, item.id, title);
  const separator = markdown === "" ? "" : "\n";
  const store =
    Object.keys(item.annotations).length === 0 ? null : serializeAnnotationStore(item.annotations);
  return { annotations: store, text: `---\n${yaml}\n---\n${separator}${markdown}` };
};
