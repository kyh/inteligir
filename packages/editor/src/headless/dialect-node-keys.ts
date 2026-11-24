import type { RICH_FENCE_LANGS } from "@repo/editor/headless/fence-langs";

type RichFenceBlockKey = NonNullable<ReturnType<(typeof RICH_FENCE_LANGS)["get"]>>;

export const FORMULA_PILL_KEY = "formulaPill";
export const TAB_GROUP_KEY = "tab_group";
export const TAB_PANEL_KEY = "tab_panel";
export const CHART_BLOCK_KEY = "chart_block" satisfies RichFenceBlockKey;
export const CANVAS_BLOCK_KEY = "canvas_block" satisfies RichFenceBlockKey;
export const HTML_BLOCK_KEY = "html_block" satisfies RichFenceBlockKey;
