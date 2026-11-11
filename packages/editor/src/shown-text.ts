import { ElementApi, TextApi } from "platejs";
import type { Descendant } from "platejs";

import { shownTitle } from "@repo/contract/items/item-name";
import { FORMULA_PILL_KEY } from "@repo/editor/dialect-node-keys";
import { libraryTitles } from "@repo/editor/host-io";
import { stringProp } from "@repo/editor/node-props";

// A node's words as the editor draws them: a page link by the name its item goes by now (the one its
// chip shows), else the title it was written with, and a date and a formula as they show.
export const shownText = (node: Descendant): string => {
  if (TextApi.isText(node)) {
    return node.text;
  }
  if (!ElementApi.isElement(node)) {
    return "";
  }
  switch (node.type) {
    case "mention": {
      const key = stringProp(node, "key");
      const now = key === undefined ? undefined : libraryTitles.getState().byId.get(key);
      return shownTitle(now ?? stringProp(node, "value") ?? "");
    }
    case "date": {
      return stringProp(node, "date") ?? "";
    }
    case FORMULA_PILL_KEY: {
      return stringProp(node, "display") ?? stringProp(node, "source") ?? "";
    }
    default: {
      return node.children.map(shownText).join("");
    }
  }
};
