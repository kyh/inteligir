// A note's live document as the library reads it: its top-level blocks in order, each in its
// section, the person's writing or the page a fill read. Both sections share one root, so an
// edit moving a block between them is one edit; a refill replaces only the article's blocks.

import { ElementApi, RangeApi, createSlateEditor, normalizeNodeId } from "platejs";
import type { TElement } from "platejs";
import { slateNodesToInsertDelta, yTextToSlateElement } from "@slate-yjs/core";
import type * as Y from "yjs";

import type { LibraryBlock, LibrarySection } from "@repo/contract/library/library-nodes";

import { BASE_KIT } from "@repo/editor/kits/base-kit";

import { blockOfElement } from "./element-block";
import { sectionOf, sectioned } from "./note-section";
import { noteRoot } from "./yjs-binding";

export interface NoteBlock {
  readonly block: LibraryBlock;
  readonly section: LibrarySection;
}

// Seeds an empty document with a note's blocks as an editor holds them: every element named, and
// normalized by the kit every editor shares, so no editor connecting to it has a fix to write
// (a stored block drops the empty texts Slate keeps beside an inline). A block a fix makes keeps
// the section of the block it came from. A note with no blocks gets one empty paragraph: an editor
// never connects to an empty root, where two at once would each write one.
export const seedDoc = (doc: Y.Doc, blocks: readonly NoteBlock[]): void => {
  const root = noteRoot(doc);
  if (root.length > 0) {
    throw new Error("seedDoc seeds an empty document");
  }
  const elements =
    blocks.length > 0
      ? blocks.map(({ block, section }) => sectioned(block, section))
      : [{ children: [{ text: "" }], section: "note", type: "p" }];
  const editor = createSlateEditor({
    nodeId: true,
    plugins: BASE_KIT,
    value: normalizeNodeId(elements),
  });
  // each block's reach, which a fix splitting it carries onto the block it makes
  const sources = editor.children.flatMap((node, index) => {
    const range = editor.api.range([index]);
    return range === undefined
      ? []
      : [{ ref: editor.api.rangeRef(range), section: sectionOf(node) }];
  });
  editor.tf.normalize({ force: true });
  const spans = sources.map(({ ref, section }) => ({ range: ref.unref(), section }));
  // a block no source reaches was made beside one, and takes the section of the block before it
  let section: LibrarySection = "note";
  const seeded = editor.children.map((node, index): TElement => {
    const span = spans.find(({ range }) => range !== null && RangeApi.includes(range, [index]));
    section = span?.section ?? section;
    return sectioned(node, section);
  });
  doc.transact(() => {
    root.applyDelta(slateNodesToInsertDelta(seeded));
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
