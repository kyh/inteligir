// A top-level element as the block the library stores: what a note's document is read as, an edit
// checks its base against and a note extracted from it is made of.

import { ElementApi } from "platejs";
import type { Descendant, TElement } from "platejs";

import { storableBlockSchema } from "@repo/contract/library/library-nodes";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";

import { PICKER_INPUT_TYPES } from "@repo/editor/combobox-input";
import { blockId } from "@repo/editor/node-props";

import { namedBlockJson, tidyBlock } from "../codec/read-blocks";

const withoutPickers = (element: TElement): TElement => ({
  ...element,
  children: element.children.flatMap((child): Descendant[] => {
    if (!ElementApi.isElement(child)) {
      return [child];
    }
    return PICKER_INPUT_TYPES.includes(child.type) ? [] : [withoutPickers(child)];
  }),
});

// The element's block in the one spelling a block is stored in, or null for one no block stores: a
// picker open in it is read around (its query is nobody's writing yet), and the ids Plate gives the
// elements inside and the section are the document's, never the block's, so every editor reads
// one block.
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
