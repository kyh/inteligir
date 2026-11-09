// A note's live document as the library reads it: its top-level blocks in order, each in its
// section, the person's writing or the page a fill read. Both sections share one root, so an
// edit moving a block between them is one edit; a refill replaces only the article's blocks.

import { ElementApi, createSlateEditor, normalizeNodeId } from "platejs";
import type { Descendant, TElement } from "platejs";
import { slateNodesToInsertDelta, yTextToSlateElement } from "@slate-yjs/core";
import type * as Y from "yjs";

import { librarySectionSchema, storableBlockSchema } from "@repo/contract/library/library-nodes";
import type { LibraryBlock, LibrarySection } from "@repo/contract/library/library-nodes";

import { PICKER_INPUT_TYPES } from "@repo/editor/combobox-input";
import { BASE_KIT } from "@repo/editor/kits/base-kit";
import { blockId } from "@repo/editor/node-props";

import { namedBlockJson, tidyBlock } from "../codec/read-blocks";
import { noteRoot } from "./yjs-binding";

export interface NoteBlock {
  readonly block: LibraryBlock;
  readonly section: LibrarySection;
}

// a top-level element's own attribute: the article's blocks say so, and one saying nothing is the
// person's, as every block the editor makes is
const SECTION_KEY = "section";

const withoutPickers = (element: TElement): TElement => ({
  ...element,
  children: element.children.flatMap((child): Descendant[] => {
    if (!ElementApi.isElement(child)) {
      return [child];
    }
    return PICKER_INPUT_TYPES.includes(child.type) ? [] : [withoutPickers(child)];
  }),
});

// A top-level element as the block the library stores, or null for one it cannot: a picker open
// in it is read around (its query is nobody's writing yet), and the ids Plate gives the elements
// inside and the section are the document's, never the block's, so every editor reads one block.
export const blockOfElement = (element: TElement): LibraryBlock | null => {
  const id = blockId(element);
  if (id === undefined) {
    return null;
  }
  const parsed = storableBlockSchema.safeParse(
    namedBlockJson({ element: tidyBlock(withoutPickers(element)) }, id),
  );
  return parsed.success ? parsed.data : null;
};

export const sectionOf = (element: TElement): LibrarySection =>
  librarySectionSchema.safeParse(element[SECTION_KEY]).data ?? "note";

export const sectioned = (block: LibraryBlock, section: LibrarySection): TElement => ({
  ...block,
  [SECTION_KEY]: section,
});

// Seeds an empty document with a note's blocks as an editor holds them: every element named, and
// normalized by the kit every editor shares, so no editor connecting to it has a fix to write
// (a stored block drops the empty texts Slate keeps beside an inline). A note with no blocks gets
// one empty paragraph: an editor never connects to an empty root, where two at once would each
// write one.
export const seedDoc = (doc: Y.Doc, blocks: readonly NoteBlock[]): void => {
  const root = noteRoot(doc);
  if (root.length > 0) {
    throw new Error("seedDoc seeds an empty document");
  }
  const elements =
    blocks.length > 0
      ? blocks.map(({ block, section }) => sectioned(block, section))
      : [{ children: [{ text: "" }], [SECTION_KEY]: "note", type: "p" }];
  const editor = createSlateEditor({
    nodeId: true,
    plugins: BASE_KIT,
    value: normalizeNodeId(elements),
  });
  editor.tf.normalize({ force: true });
  doc.transact(() => {
    root.applyDelta(slateNodesToInsertDelta(editor.children));
  });
};

// The document's blocks in order; an element no block stores is left out of the library's view.
export const readBlocks = (doc: Y.Doc): NoteBlock[] =>
  yTextToSlateElement(noteRoot(doc)).children.flatMap((node): NoteBlock[] => {
    if (!ElementApi.isElement(node)) {
      return [];
    }
    const block = blockOfElement(node);
    return block === null ? [] : [{ block, section: sectionOf(node) }];
  });
