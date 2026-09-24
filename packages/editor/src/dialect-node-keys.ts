// Every dialect node's Slate type, spelled once: the plugin's key, the rule table's serialize key,
// a deserializer's `type` and every walk's match. Alone in a module that imports no value, so the
// kits, the rule table and the walks all reach it without closing a cycle around the kits.
// Plate's own nodes are spelled by its KEYS.

import type { RICH_FENCE_LANGS } from "@repo/notes/markdown/fence-langs";

// the fence map names the rich blocks too; `satisfies` holds the two spellings together
type RichFenceBlockKey = NonNullable<ReturnType<(typeof RICH_FENCE_LANGS)["get"]>>;

export const FRONTMATTER_KEY = "frontmatter";
export const WIKI_LINK_KEY = "wikiLink";
export const WIKI_EMBED_KEY = "wikiEmbed";
export const FORMULA_PILL_KEY = "formulaPill";
export const COMMENT_MARKER_KEY = "commentMarker";
export const TAB_GROUP_KEY = "tab_group";
export const TAB_PANEL_KEY = "tab_panel";
export const OPAQUE_BLOCK_KEY = "opaqueBlock";
export const OPAQUE_INLINE_KEY = "opaqueInline";
export const CHART_BLOCK_KEY = "chart_block" satisfies RichFenceBlockKey;
export const CANVAS_BLOCK_KEY = "canvas_block" satisfies RichFenceBlockKey;
export const HTML_BLOCK_KEY = "html_block" satisfies RichFenceBlockKey;
