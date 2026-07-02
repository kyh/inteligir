// Block selection + block menu + cursor overlay. Constraint carried from
// WP1/WP2: block selection excludes `frontmatter` (pinned at [0], edited via
// Raw only), `column` (column internals move with their group), `codeLine`,
// and `td`. The context menu and the drag-grip menu are ONE implementation
// (block-menu.tsx) driven by BlockMenuPlugin's openId/position.

import {
  BlockMenuPlugin,
  BlockSelectionPlugin,
  CursorOverlayPlugin,
} from "@platejs/selection/react";
import { KEYS, getPluginTypes } from "platejs";

import { BlockContextMenu } from "@repo/app/editor/block-context-menu";
import { BlockSelection } from "@repo/app/editor/block-selection";
import { CursorOverlay } from "@repo/app/editor/cursor-overlay";

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
  // Selection ghost while menus/popovers hold focus (Phase F's AI menu
  // depends on it — plumbed now so it doesn't re-plumb).
  CursorOverlayPlugin.configure({
    render: { afterEditable: () => <CursorOverlay /> },
  }),
];
