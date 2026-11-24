import { ElementApi, KEYS } from "platejs";
import type { Path } from "platejs";
import type { PlateEditor } from "platejs/react";
import { BaseTogglePlugin } from "@platejs/toggle";

import { stringProp } from "@repo/editor/headless/node-props";

export const wrapBlockInToggle = (editor: PlateEditor, at: Path) => {
  editor.tf.withoutNormalizing(() => {
    const entry = editor.api.node(at);

    if (!entry || !ElementApi.isElement(entry[0]) || entry[0].type === KEYS.toggle) {
      return;
    }

    editor.tf.unsetNodes(["listStyleType", "listStart", "indent", "checked"], { at });
    editor.tf.wrapNodes({ children: [], type: KEYS.toggle }, { at });
  });
  const toggle = editor.api.node(at);
  const id = toggle ? stringProp(toggle[0], "id") : undefined;

  if (id !== undefined && id !== "") {
    editor.getApi(BaseTogglePlugin).toggle.toggleIds([id], true);
  }
};

export const insertToggle = (editor: PlateEditor) => {
  const block = editor.api.block();

  if (!block) {
    return;
  }

  wrapBlockInToggle(editor, block[1]);
};
