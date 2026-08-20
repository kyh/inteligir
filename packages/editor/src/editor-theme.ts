import { EditorView } from "@codemirror/view";

const fontStack =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const monoStack =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace";

const accent = "var(--editor-accent, var(--editor-accent-fallback))";

// Palettes as CSS custom properties so the vendored ProseMark pieces (which
// read --pm-*) and the house rules share one source. Light is the base, on the
// editor root; dark redefines only the tokens, under `:root[data-theme="dark"]`.
//
// THE HOST STAMPS `data-theme`, and a `prefers-color-scheme` media query is
// not an option here — it is a style-mod limitation, not a preference.
// `EditorView.theme` compiles through style-mod, which substitutes `&` with
// the ENCLOSING SELECTOR, and inside an at-rule that enclosing selector is the
// at-rule's own text: `@media (…) { ":root:not(…) &": tokens }` compiles to
// `.cm-theme :root:not(…) @media (…) { … }`, which matches nothing and fails
// silently. Every consumer therefore resolves the theme itself and stamps it
// (apps/app's EditorThemeCarrier; `dev/main.ts` for the demo);
// `__tests__/theme-carrier.test.ts` keeps the dead pattern from coming back.
const lightTokens = {
  "--editor-accent-fallback": "oklch(58.8% 0.158 241.966)",
  "--editor-fg": "oklch(24% 0.012 260)",
  "--editor-faint": "oklch(72% 0.015 260)",
  "--pm-header-mark-color": "oklch(72% 0.015 260)",
  "--pm-muted-color": "oklch(50% 0.03 257)",
  "--pm-link-color": accent,
  "--pm-code-background-color": "oklch(96% 0.006 260)",
  "--pm-code-btn-background-color": "oklch(92% 0.01 260)",
  "--pm-code-btn-hover-background-color": "oklch(87% 0.015 260)",
  "--pm-blockquote-vertical-line-background-color": "oklch(88% 0.015 260)",
  "--pm-syntax-link": "oklch(62.75% 0.188 259.38)",
  "--pm-syntax-keyword": "oklch(58.13% 0.248 297.57)",
  "--pm-syntax-atom": "oklch(51.29% 0.219 260.63)",
  "--pm-syntax-literal": "oklch(57.38% 0.111 170.31)",
  "--pm-syntax-string": "oklch(54.86% 0.184 25.53)",
  "--pm-syntax-regexp": "oklch(65.88% 0.184 43.8)",
  "--pm-syntax-definition-variable": "oklch(45.32% 0.171 260.3)",
  "--pm-syntax-local-variable": "oklch(64.13% 0.09 184.42)",
  "--pm-syntax-type-namespace": "oklch(49.1% 0.091 165.52)",
  "--pm-syntax-class-name": "oklch(64.42% 0.11 168.83)",
  "--pm-syntax-special-variable-macro": "oklch(52.58% 0.212 282.71)",
  "--pm-syntax-definition-property": "oklch(42.1% 0.142 260.08)",
  "--pm-syntax-comment": "oklch(62.79% 0.022 252.89)",
  "--pm-syntax-invalid": "oklch(64.62% 0.203 29.2)",
};

const darkTokens = {
  "--editor-accent-fallback": "oklch(72% 0.14 241.966)",
  "--editor-fg": "oklch(88% 0.01 260)",
  "--editor-faint": "oklch(48% 0.02 260)",
  "--pm-header-mark-color": "oklch(48% 0.02 260)",
  "--pm-muted-color": "oklch(68% 0.025 257)",
  "--pm-link-color": accent,
  "--pm-code-background-color": "oklch(28% 0.012 260)",
  "--pm-code-btn-background-color": "oklch(34% 0.015 260)",
  "--pm-code-btn-hover-background-color": "oklch(42% 0.02 260)",
  "--pm-blockquote-vertical-line-background-color": "oklch(40% 0.02 260)",
  "--pm-syntax-link": "oklch(75% 0.14 259.38)",
  "--pm-syntax-keyword": "oklch(74% 0.17 297.57)",
  "--pm-syntax-atom": "oklch(72% 0.15 260.63)",
  "--pm-syntax-literal": "oklch(76% 0.1 170.31)",
  "--pm-syntax-string": "oklch(73% 0.14 25.53)",
  "--pm-syntax-regexp": "oklch(76% 0.15 43.8)",
  "--pm-syntax-definition-variable": "oklch(72% 0.13 260.3)",
  "--pm-syntax-local-variable": "oklch(78% 0.08 184.42)",
  "--pm-syntax-type-namespace": "oklch(74% 0.09 165.52)",
  "--pm-syntax-class-name": "oklch(78% 0.1 168.83)",
  "--pm-syntax-special-variable-macro": "oklch(75% 0.15 282.71)",
  "--pm-syntax-definition-property": "oklch(72% 0.11 260.08)",
  "--pm-syntax-comment": "oklch(60% 0.02 252.89)",
  "--pm-syntax-invalid": "oklch(70% 0.17 29.2)",
};

/**
 * The house look: typography and palette driven entirely by CSS custom
 * properties (--editor-font/-mono/-size/-line-height/-width/-accent) so the
 * app's appearance system can restyle the editor without touching extensions.
 * Light is the base; `:root[data-theme="dark"]` swaps the palette, and the
 * host is what stamps it (see the note above).
 */
export const editorThemeExtension = EditorView.theme({
  "&": {
    ...lightTokens,
    "--pm-code-font": `var(--editor-mono, ${monoStack})`,
    color: "var(--editor-fg)",
    fontFamily: `var(--editor-font, ${fontStack})`,
    fontSize: "var(--editor-size, 1rem)",
    lineHeight: "var(--editor-line-height, 1.75)",
  },
  ':root[data-theme="dark"] &': darkTokens,

  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "inherit",
  },
  ".cm-content": {
    maxWidth: "var(--editor-width)",
    marginInline: "auto",
    padding: "1.25rem 1.75rem 40vh",
    caretColor: accent,
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: accent,
    borderLeftWidth: "2px",
  },
  ".cm-selectionBackground": {
    background: `color-mix(in oklab, ${accent} 14%, transparent)`,
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    background: `color-mix(in oklab, ${accent} 22%, transparent)`,
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "var(--editor-faint)",
  },
  ".cm-foldGutter": {
    opacity: "0",
    transition: "opacity 120ms ease-out",
  },
  "&:hover .cm-foldGutter": {
    opacity: "1",
  },

  // Every tooltip this editor shows is house chrome (the slash menu, the
  // delegation bar), so the box they share is dressed ONCE here rather than
  // per extension: CodeMirror's base theme paints `.cm-tooltip` as a light
  // `#f5f5f5` card that ignores this palette entirely, and one class is
  // enough to beat it because a theme mounts after the base theme. That order
  // cuts the other way against the extensions — the house stack mounts before
  // them, so one that wants to REPLACE a property named here must outrank
  // this rule (`.cm-slash-menu.cm-tooltip`) rather than restate it. Today
  // each adds only its own layout, sizing and shadow.
  ".cm-tooltip": {
    border: "1px solid var(--chip-border, oklch(88% 0.01 260))",
    borderRadius: "8px",
    background: "var(--pm-code-background-color)",
    color: "var(--editor-fg)",
  },

  ".cm-rendered-link": {
    textDecoration: "underline",
    textUnderlineOffset: "0.15em",
    cursor: "pointer",
    color: "var(--pm-link-color)",
  },
  ".cm-url": {
    cursor: "pointer",
  },
  ".cm-rendered-list-mark": {
    color: "var(--pm-muted-color)",
    margin: "0 0.2em",
  },
  ".cm-inline-code": {
    fontFamily: "var(--pm-code-font)",
    fontVariantLigatures: "none",
    fontFeatureSettings: '"calt" 0',
    fontKerning: "none",
    padding: "0.1em 0.3em",
    borderRadius: "0.3em",
    fontSize: "0.85em",
    backgroundColor: "var(--pm-code-background-color)",
  },
  ".cm-blockquote-line": {
    position: "relative",
    color: "var(--pm-muted-color)",
    "&:before": {
      content: '""',
      display: "block",
      borderLeft: "solid 0.2em var(--pm-blockquote-vertical-line-background-color)",
      position: "absolute",
      top: "0px",
      bottom: "0px",
      insetInlineStart: "6px",
      zIndex: -10,
    },
  },
  ".cm-nested-blockquote-border": {
    display: "block",
    borderLeft: "solid 0.2em var(--pm-blockquote-vertical-line-background-color)",
    position: "absolute",
    top: "0px",
    bottom: "0px",
    insetInlineStart: "calc(6px + var(--blockquote-border-offset))",
    zIndex: -10,
  },
  ".cm-horizontal-rule-container hr": {
    border: "none",
    borderTop: "1px solid var(--editor-faint)",
  },
});
