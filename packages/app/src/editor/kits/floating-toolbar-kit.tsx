// Renders the selection toolbar from the plugin tree (afterEditable) instead
// of markdown-editor.tsx JSX, so it sits inside the editor's relative
// positioning context that @platejs/floating computes against.

import { createPlatePlugin } from "platejs/react";

import { SelectionToolbar } from "@repo/app/editor/selection-toolbar";

export const FloatingToolbarKit = [
  createPlatePlugin({
    key: "floating-toolbar",
    render: { afterEditable: () => <SelectionToolbar /> },
  }),
];
