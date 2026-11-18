import type { ReactNode } from "react";
import {
  BLOCK_CONTEXT_MENU_ID,
  BlockMenuPlugin,
  BlockSelectionPlugin,
} from "@platejs/selection/react";
import { useEditorPlugin } from "platejs/react";

import { BlockMenu } from "@repo/editor/block-menu";

export const BlockContextMenu = ({ children }: { children: ReactNode }) => {
  const { api, editor } = useEditorPlugin(BlockMenuPlugin);

  return (
    <div
      className="group/context-menu w-full"
      data-plate-selectable
      onContextMenu={(event) => {
        const { target } = event;

        if (!(target instanceof HTMLElement)) {
          return;
        }

        if (target.dataset.slateEditor === "true") {
          return;
        }

        if (editor.getOption(BlockSelectionPlugin, "selectedIds")?.size === 0) {
          return;
        }

        event.preventDefault();
        api.blockMenu.show(BLOCK_CONTEXT_MENU_ID, { x: event.clientX, y: event.clientY });
      }}
    >
      {children}
      <BlockMenu />
    </div>
  );
};
