// The dialect's fenced-block languages, in ONE place: the editor's rule table
// maps them to nodes and the knowledge scan re-reads a callout's body, so a
// spelling that drifted between the two would silently stop indexing links
// inside callouts.

/** The callout fence — payload is a kind line, an optional level, then body. */
export const CALLOUT_LANG = "inteligir-callout";

export function isCalloutLang(lang: string | null | undefined): boolean {
  return lang === CALLOUT_LANG;
}

/** Rich payload fences: the wire spelling written for each node type. */
export const CHART_LANG = "inteligir-chart";
export const CANVAS_LANG = "inteligir-canvas";
export const HTML_LANG = "inteligir-html";

/** Every fence lang that maps to a rich block node. */
export const RICH_FENCE_LANGS: ReadonlyMap<string, "canvas_block" | "chart_block" | "html_block"> =
  new Map([
    [CANVAS_LANG, "canvas_block"],
    [CHART_LANG, "chart_block"],
    [HTML_LANG, "html_block"],
  ]);
