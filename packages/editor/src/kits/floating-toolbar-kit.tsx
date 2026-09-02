// Rendered from the plugin tree so it sits inside the positioning context @platejs/floating computes against.

import { createPlatePlugin } from "platejs/react";

import { SelectionToolbar } from "@repo/editor/selection-toolbar";

export const FloatingToolbarKit = [
  createPlatePlugin({
    key: "floating-toolbar",
    render: { afterEditable: () => <SelectionToolbar /> },
  }),
];
