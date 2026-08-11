// ---------------------------------------------------------------------------
// The appearance record — every knob the user has over how the workspace reads.
//
// It needs no channel of its own: `ui-state` is a schemaless key→JSON map, so
// the whole record persists under ONE key and arrives with the boot bundle.
// What it needs instead is a parse at the boundary (the stored value is
// `unknown`) and one place that turns it into CSS.
//
// Every knob is a CSS custom property, and `packages/workspace/src/styles/
// globals.css` declares the same defaults on `:root`. That is what lets the
// first paint be correct before the store has hydrated, and what keeps this
// module free of any component: it writes seven properties and nothing reads
// it back.
// ---------------------------------------------------------------------------

export type FontOption = { readonly label: string; readonly stack: string };
export type AccentOption = { readonly label: string; readonly color: string };
export type NumericRange = {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly fallback: number;
};

/** The document's text face. `sans` is the app's own Inter; the rest are
 * stacks rather than shipped faces, so picking one costs no download. */
export const EDITOR_FONTS = {
  sans: { label: "Sans", stack: "var(--font-inter)" },
  serif: { label: "Serif", stack: 'ui-serif, Georgia, Cambria, "Times New Roman", serif' },
  mono: { label: "Mono", stack: "var(--font-geist-mono)" },
  system: { label: "System", stack: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
} satisfies Record<string, FontOption>;

/** Code blocks, inline code, and the Raw editing surface. */
export const MONO_FONTS = {
  geist: { label: "Geist Mono", stack: "var(--font-geist-mono)" },
  system: { label: "System", stack: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
} satisfies Record<string, FontOption>;

/** One colour per accent, picked to read on both the light and the dark
 * canvas — the accent is set inline on `:root`, so it cannot be theme-aware
 * without the theme becoming an input to this module. `blue` reproduces the
 * stock focus ring exactly, which is what makes it the default. */
export const ACCENTS = {
  blue: { label: "Blue", color: "#6b97ff" },
  violet: { label: "Violet", color: "#8b7bf7" },
  green: { label: "Green", color: "#3aa06b" },
  amber: { label: "Amber", color: "#c8862a" },
  rose: { label: "Rose", color: "#df5f7d" },
  slate: { label: "Slate", color: "#7b8794" },
} satisfies Record<string, AccentOption>;

export type EditorFont = keyof typeof EDITOR_FONTS;
export type MonoFont = keyof typeof MONO_FONTS;
export type Accent = keyof typeof ACCENTS;
type EditorWidth = "narrow" | "full";

/** The tables' own keys, typed — so a picker iterates the table rather than a
 * second list that can fall behind it. */
function keysOf<T extends object>(table: T): (keyof T)[] {
  return Object.keys(table).filter((key): key is string & keyof T => Object.hasOwn(table, key));
}

export const EDITOR_FONT_KEYS: readonly EditorFont[] = keysOf(EDITOR_FONTS);
export const MONO_FONT_KEYS: readonly MonoFont[] = keysOf(MONO_FONTS);
export const ACCENT_KEYS: readonly Accent[] = keysOf(ACCENTS);

export const FONT_SIZE: NumericRange = { min: 13, max: 22, step: 1, fallback: 16 };
export const LINE_HEIGHT: NumericRange = { min: 1.3, max: 2.2, step: 0.1, fallback: 1.8 };
/** A percentage: how visible borders, inputs and dividers are against the
 * canvas. 100 lands on the stock token values. */
export const CHROME_CONTRAST: NumericRange = { min: 40, max: 180, step: 10, fallback: 100 };

export type Appearance = {
  editorFont: EditorFont;
  monoFont: MonoFont;
  fontSize: number;
  lineHeight: number;
  editorWidth: EditorWidth;
  accent: Accent;
  chromeContrast: number;
};

export const DEFAULT_APPEARANCE: Appearance = {
  editorFont: "sans",
  monoFont: "geist",
  fontSize: FONT_SIZE.fallback,
  lineHeight: LINE_HEIGHT.fallback,
  editorWidth: "narrow",
  accent: "blue",
  chromeContrast: CHROME_CONTRAST.fallback,
};

function isKeyOf<T extends object>(table: T, value: unknown): value is keyof T {
  return typeof value === "string" && Object.hasOwn(table, value);
}

function keyOf<T extends object>(table: T, value: unknown, fallback: keyof T): keyof T {
  return isKeyOf(table, value) ? value : fallback;
}

function numberIn(range: NumericRange, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return range.fallback;
  return Math.min(range.max, Math.max(range.min, value));
}

/**
 * Parse the stored row. Every field falls back on its own, so a record written
 * by an older build (or a hand-edited one) yields a usable appearance rather
 * than the whole thing reverting.
 */
export function parseAppearance(value: unknown): Appearance {
  if (typeof value !== "object" || value === null) return DEFAULT_APPEARANCE;
  const row: Record<string, unknown> = { ...value };
  return {
    editorFont: keyOf(EDITOR_FONTS, row.editorFont, DEFAULT_APPEARANCE.editorFont),
    monoFont: keyOf(MONO_FONTS, row.monoFont, DEFAULT_APPEARANCE.monoFont),
    fontSize: numberIn(FONT_SIZE, row.fontSize),
    lineHeight: numberIn(LINE_HEIGHT, row.lineHeight),
    editorWidth: row.editorWidth === "full" ? "full" : "narrow",
    accent: keyOf(ACCENTS, row.accent, DEFAULT_APPEARANCE.accent),
    chromeContrast: numberIn(CHROME_CONTRAST, row.chromeContrast),
  };
}

/** The half-width the centred reading column is inset by. `full` gives the
 * document the whole pane minus the editor's own minimum padding. */
function columnInset(width: EditorWidth): string {
  return width === "full" ? "0px" : "calc(50% - 350px)";
}

/**
 * The ONE place an appearance becomes CSS. Hydration, every mutation and the
 * reset all reach the document through this call and no other.
 */
export function applyAppearanceSideEffects(appearance: Appearance): void {
  const root = document.documentElement.style;
  root.setProperty("--editor-font-family", EDITOR_FONTS[appearance.editorFont].stack);
  root.setProperty("--editor-mono-family", MONO_FONTS[appearance.monoFont].stack);
  root.setProperty("--editor-font-size", `${String(appearance.fontSize)}px`);
  root.setProperty("--editor-line-height", String(appearance.lineHeight));
  root.setProperty("--editor-column-inset", columnInset(appearance.editorWidth));
  root.setProperty("--accent-color", ACCENTS[appearance.accent].color);
  root.setProperty("--chrome-contrast", String(appearance.chromeContrast / 100));
}
