// the editor's rule table reads these and the skills guard holds the skills and the seed to them;
// a drifted spelling silently opens the block as plain code.

export const CHART_LANG = "inteligir-chart";
export const CANVAS_LANG = "inteligir-canvas";
export const HTML_LANG = "inteligir-html";

export const RICH_FENCE_LANGS: ReadonlyMap<string, "canvas_block" | "chart_block" | "html_block"> =
  new Map([
    [CANVAS_LANG, "canvas_block"],
    [CHART_LANG, "chart_block"],
    [HTML_LANG, "html_block"],
  ]);
