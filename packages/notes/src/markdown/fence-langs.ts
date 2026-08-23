// The dialect's fenced-block languages, in ONE place: the editor's rule table
// maps them to nodes and the knowledge scan re-reads a callout's body, so a
// spelling that drifted between the two would silently stop indexing links
// inside callouts.
//
// Moss's `moss-*` spellings PARSE FOREVER — vaults exist that hold them, and a
// note must open unchanged. Only the `inteligir-*` spelling is ever WRITTEN,
// so a legacy note canonicalizes on its first save (the churn fixtures pin
// exactly that).

/** The callout fence — payload is a kind line, an optional level, then body. */
export const CALLOUT_LANG = "inteligir-callout";

/** Legacy callout spellings that still parse. */
export const LEGACY_CALLOUT_LANGS: readonly string[] = ["moss-callout"];

/** Every spelling a callout fence may arrive as. */
export function isCalloutLang(lang: string | null | undefined): boolean {
  return (
    lang === CALLOUT_LANG ||
    (lang !== null && lang !== undefined && LEGACY_CALLOUT_LANGS.includes(lang))
  );
}

/** Rich payload fences: the wire spelling written for each node type. */
export const CHART_LANG = "inteligir-chart";
export const CANVAS_LANG = "inteligir-canvas";
export const HTML_LANG = "inteligir-html";

/**
 * Every fence lang that maps to a rich block node, ours and Moss's alike.
 * `moss-sketch` was Moss's own earlier name for the canvas payload; it lands
 * on the same node and re-emits as ours, like every other legacy spelling.
 */
export const RICH_FENCE_LANGS: ReadonlyMap<string, "canvas_block" | "chart_block" | "html_block"> =
  new Map([
    [CANVAS_LANG, "canvas_block"],
    [CHART_LANG, "chart_block"],
    [HTML_LANG, "html_block"],
    ["moss-canvas", "canvas_block"],
    ["moss-chart", "chart_block"],
    ["moss-html", "html_block"],
    ["moss-sketch", "canvas_block"],
  ]);

/**
 * Rewrite the legacy spellings this dialect still parses into the ones it
 * writes. NOT a serializer step and never applied to output — its one caller
 * is the rich-safety comparison, which measures whether a round trip lost
 * CONTENT by comparing letters. A deliberate rename (`moss-callout` →
 * `inteligir-callout`, `%%m:` → `%%i:`) changes letters without losing
 * anything, so without this every legacy note reads as unsafe and opens raw —
 * which is the one thing the parse-forever promise exists to prevent.
 */
export function normalizeLegacySpellings(markdown: string): string {
  let out = markdown;
  for (const legacy of [...LEGACY_CALLOUT_LANGS, "moss-canvas", "moss-chart", "moss-html"]) {
    out = out.replaceAll(legacy, `inteligir-${legacy.slice("moss-".length)}`);
  }
  // Moss's earlier name for the canvas payload lands on the canvas fence.
  out = out.replaceAll("moss-sketch", CANVAS_LANG);
  return out.replace(/%%m:([A-Za-z0-9_,-]+):(start|end)%%/gu, "%%i:$1:$2%%");
}
