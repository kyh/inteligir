// the editor's rule table and the knowledge scan both read these; a drifted spelling silently
// stops indexing links inside callouts.

// read and round-tripped, never written new or taught: the callout is the GitHub alert. Existing
// notes keep this fence because it carries kinds the alert grammar cannot spell (info, error, a
// priority with its level), and rewriting it on save would churn a byte-stable construct.
export const COMPAT_CALLOUT_LANG = "inteligir-callout";

export const isCalloutLang = (lang: string | null | undefined): boolean =>
  lang === COMPAT_CALLOUT_LANG;

export const CHART_LANG = "inteligir-chart";
export const CANVAS_LANG = "inteligir-canvas";
export const HTML_LANG = "inteligir-html";

export const RICH_FENCE_LANGS: ReadonlyMap<string, "canvas_block" | "chart_block" | "html_block"> =
  new Map([
    [CANVAS_LANG, "canvas_block"],
    [CHART_LANG, "chart_block"],
    [HTML_LANG, "html_block"],
  ]);
