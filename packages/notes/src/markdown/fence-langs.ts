// the editor's rule table and the knowledge scan both read these; a drifted spelling silently
// stops indexing links inside callouts.

export const CALLOUT_LANG = "inteligir-callout";

export function isCalloutLang(lang: string | null | undefined): boolean {
  return lang === CALLOUT_LANG;
}

export const CHART_LANG = "inteligir-chart";
export const CANVAS_LANG = "inteligir-canvas";
export const HTML_LANG = "inteligir-html";

export const RICH_FENCE_LANGS: ReadonlyMap<string, "canvas_block" | "chart_block" | "html_block"> =
  new Map([
    [CANVAS_LANG, "canvas_block"],
    [CHART_LANG, "chart_block"],
    [HTML_LANG, "html_block"],
  ]);
