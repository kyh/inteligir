// Column kit — Base half (WP1). Node shapes:
//   { type: "column_group", children: column[] }
//   { type: "column", width?: string, children: Block[] }
// Canonical insert form is BARE `<column>` (no width until the first resize
// commit — locked decision). WP2 appends ColumnKit (+ commit-on-release
// resize) and insertColumnGroup.

import { BaseColumnItemPlugin, BaseColumnPlugin } from "@platejs/layout";

export const ColumnBaseKit = [BaseColumnPlugin, BaseColumnItemPlugin];
