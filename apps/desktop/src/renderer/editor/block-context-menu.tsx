// Right-click surface (BlockMenuPlugin's aboveSlate wrapper). Bubbling order
// does the selection: BlockSelectionPlugin injects an onContextMenu on each
// selectable block (addOnContextMenu) that selects it — or stops propagation
// when the right-click lands on focused text (native menu wins there, potion
// behavior) — and this wrapper, reached only when propagation survived, opens
// the shared BlockMenu at the pointer.

import type { ReactNode } from "react";
import {
  BLOCK_CONTEXT_MENU_ID,
  BlockMenuPlugin,
  BlockSelectionPlugin,
} from "@platejs/selection/react";
import { useEditorPlugin } from "platejs/react";

import { BlockMenu } from "@renderer/editor/block-menu";

export function BlockContextMenu({ children }: { children: ReactNode }) {
  const { api, editor } = useEditorPlugin(BlockMenuPlugin);

  return (
    <div
      className="group/context-menu w-full"
      data-plate-selectable
      onContextMenu={(event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        // Right-click on the editable surface itself (its padding, not a
        // block) keeps the native menu.
        if (target.dataset.slateEditor === "true") return;
        // No block took the right-click (e.g. frontmatter is not
        // selectable) → nothing for the menu to act on.
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
