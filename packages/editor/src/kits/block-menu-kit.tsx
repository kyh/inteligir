// Block selection + block menu + cursor overlay. Constraint:
// block selection excludes `frontmatter` (pinned at [0], edited via
// Raw only), `column` (column internals move with their group), `codeLine`,
// and `td`. The context menu and the drag-grip menu are ONE implementation
// (block-menu.tsx) driven by BlockMenuPlugin's openId/position.

import {
  BlockMenuPlugin,
  BlockSelectionPlugin,
  CursorOverlayPlugin,
} from "@platejs/selection/react";
import { KEYS, getPluginTypes } from "platejs";

import { BlockContextMenu } from "@repo/editor/block-context-menu";
import { BlockSelection } from "@repo/editor/block-selection";
import { CursorOverlay } from "@repo/editor/cursor-overlay";

export const BlockMenuKit = [
  BlockSelectionPlugin.configure(({ editor }) => ({
    options: {
      enableContextMenu: true,
      isSelectable: (element) =>
        !getPluginTypes(editor, [KEYS.column, KEYS.codeLine, KEYS.td]).includes(element.type) &&
        element.type !== "frontmatter",
    },
    render: {
      belowRootNodes: (props) => {
        if (!props.attributes.className?.includes("slate-selectable")) return null;
        return <BlockSelection pluginKey={props.plugin.key} />;
      },
    },
  })),
  BlockMenuPlugin.configure({
    render: { aboveSlate: BlockContextMenu },
  }),
  // Selection ghost while menus/popovers hold focus (the AI menu
  // depends on it).
  CursorOverlayPlugin.configure({
    render: { afterEditable: () => <CursorOverlay /> },
  }),
];
