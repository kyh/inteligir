import { ElementApi } from "platejs";
import type { Descendant, TElement } from "platejs";

import { storableBlockSchema } from "@repo/contract/library/library-nodes";

import { PICKER_INPUT_TYPES } from "@repo/editor/headless/combobox-input";
import { blockId } from "@repo/editor/headless/node-props";

import { namedBlockJson, tidyBlock } from "@repo/editor/headless/codec/read-blocks";

const withoutPickers: (element: TElement) => TElement = (element) => ({
  ...element,
  children: element.children.flatMap<Descendant>((child) => {
    if (!ElementApi.isElement(child)) {
      return [child];
    }

    return PICKER_INPUT_TYPES.includes(child.type) ? [] : [withoutPickers(child)];
  }),
});

export const blockOfElement = (element: TElement) => {
  const id = blockId(element);

  if (id === undefined) {
    return null;
  }

  const parsed = storableBlockSchema.safeParse(
    namedBlockJson({ element: tidyBlock(withoutPickers(element)) }, id),
  );

  return parsed.success ? parsed.data : null;
};
