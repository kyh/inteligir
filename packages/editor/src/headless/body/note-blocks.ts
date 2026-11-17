// A note's body as an editor holds it: its top-level blocks in order, each in its section, the
// person's writing or the page a fill read. Both sections share one root, so an edit moving a
// block between them is one edit; a refill replaces only the article's blocks.

import { ElementApi, RangeApi, createSlateEditor, normalizeNodeId } from "platejs";
import type { Descendant, TElement } from "platejs";

import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibrarySection } from "@repo/contract/library/library-nodes";

import { BASE_KIT } from "@repo/editor/headless/kits/base-kit";

import { blockOfElement } from "./element-block";
import { sectionOf, sectioned } from "./note-section";

// The value an editor opens a body with: every element named, and normalized by the kit every
// editor shares, so no editor opening it has a fix to write (a stored block drops the empty texts
// Slate keeps beside an inline). A block a fix makes keeps the section of the block it came from.
// A body with no blocks opens as one empty paragraph of the person's, the line a caret lands on.
export const editorValueOf = (blocks: readonly BodyBlock[]): TElement[] => {
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
  return editor.children.map((node, index): TElement => {
    const span = spans.find(({ range }) => range !== null && RangeApi.includes(range, [index]));
    section = span?.section ?? section;
    return sectioned(node, section);
  });
};

// The blocks an editor's value holds, in order; an element no block stores is left out.
export const blocksOfValue = (value: readonly Descendant[]): BodyBlock[] =>
  value.flatMap((node): BodyBlock[] => {
    if (!ElementApi.isElement(node)) {
      return [];
    }
    const block = blockOfElement(node);
    return block === null ? [] : [{ block, section: sectionOf(node) }];
  });
