// frontmatter is not selectable: pinned at [0], edited through the properties panel.

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
  CursorOverlayPlugin.configure({
    render: { afterEditable: () => <CursorOverlay /> },
  }),
];
