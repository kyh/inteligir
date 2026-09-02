// BlockSelectionPlugin's own onContextMenu selects the block, or stops propagation
// on focused text, before this bubbles here; a right-click on the editable's padding
// or one no block claimed keeps the native menu.

import type { ReactNode } from "react";
import {
  BLOCK_CONTEXT_MENU_ID,
  BlockMenuPlugin,
  BlockSelectionPlugin,
} from "@platejs/selection/react";
import { useEditorPlugin } from "platejs/react";

import { BlockMenu } from "@repo/editor/block-menu";

export function BlockContextMenu({ children }: { children: ReactNode }) {
  const { api, editor } = useEditorPlugin(BlockMenuPlugin);

  return (
    <div
      className="group/context-menu w-full"
      data-plate-selectable
      onContextMenu={(event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.dataset.slateEditor === "true") return;
        if (editor.getOption(BlockSelectionPlugin, "selectedIds")?.size === 0) return;
        event.preventDefault();
        api.blockMenu.show(BLOCK_CONTEXT_MENU_ID, { x: event.clientX, y: event.clientY });
      }}
    >
      {children}
      <BlockMenu />
    </div>
  );
}
