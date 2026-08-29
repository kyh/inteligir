// The editor's appearance: the CSS custom properties the document's typography
// reads (`--editor-font`/`-size`/`-line-height`) plus the measure every column
// lines up on (`--editor-width`). `.typeset-docs` maps the first three onto the
// typeset scale the WYSIWYG renders through; the pane's title and its Raw
// textarea read them directly.
//
// ONE funnel reaches the document. Each axis is a small table of named options,
// and the option that IS the stylesheet's default carries `css: null` — so the
// default value is written once, in `styles/globals.css`, and this module can
// never drift from it. Choosing that option removes the inline property rather
// than restating it.

import { useLayoutEffect, useMemo, useState, createContext, useContext } from "react";
import { z } from "zod";
import { readAppearance, writeAppearance } from "./prefs";

type EditorFont = "sans" | "serif" | "mono";
type EditorSize = "small" | "normal" | "large";
type EditorLeading = "tight" | "normal" | "relaxed";
type EditorMeasure = "narrow" | "normal" | "wide";

interface Option<Value extends string> {
  readonly value: Value;
  readonly label: string;
  /** `null` = whatever `styles/globals.css` declares for this token. */
  readonly css: string | null;
}

export const EDITOR_FONTS: readonly Option<EditorFont>[] = [
  { value: "sans", label: "Sans", css: null },
  { value: "serif", label: "Serif", css: 'ui-serif, Charter, Georgia, "Times New Roman", serif' },
  { value: "mono", label: "Mono", css: "var(--font-geist-mono)" },
];

/** The document's BASE size: typeset scales headings, code and captions off it,
 *  so these are the three sizes ordinary prose comes out at. */
export const EDITOR_SIZES: readonly Option<EditorSize>[] = [
  { value: "small", label: "Small", css: "13px" },
  { value: "normal", label: "Normal", css: null },
  { value: "large", label: "Large", css: "16px" },
];

export const EDITOR_LEADINGS: readonly Option<EditorLeading>[] = [
  { value: "tight", label: "Tight", css: "1.55" },
  { value: "normal", label: "Normal", css: null },
  { value: "relaxed", label: "Relaxed", css: "1.95" },
];

/** Measured in the running editor at the default size, in ordinary prose:
 *  ~59, ~70 and ~81 characters to the line. The column's own padding is inside
 *  the value, so these are not the widths the text gets. */
export const EDITOR_MEASURES: readonly Option<EditorMeasure>[] = [
  { value: "narrow", label: "Narrow", css: "32rem" },
  { value: "normal", label: "Normal", css: null },
  { value: "wide", label: "Wide", css: "44rem" },
];

export interface Appearance {
  readonly font: EditorFont;
  readonly size: EditorSize;
  readonly leading: EditorLeading;
  readonly measure: EditorMeasure;
}

export const APPEARANCE_DEFAULTS: Appearance = {
  font: "sans",
  size: "normal",
  leading: "normal",
  measure: "normal",
};

/** The record as localStorage holds it: four optional strings, because a user
 *  can edit the key by hand and a field of the wrong type is the same fact as
 *  a missing one. A key naming no axis is stripped rather than refused. */
const storedAppearanceSchema = z
  .object({
    font: z.string().optional().catch(undefined),
    size: z.string().optional().catch(undefined),
    leading: z.string().optional().catch(undefined),
    measure: z.string().optional().catch(undefined),
  })
  .catch({});

/** The option table is each axis's vocabulary: a value outside it reads as the
 *  default rather than reaching the document unrecognized. */
function pick<Value extends string>(
  options: readonly Option<Value>[],
  raw: string | undefined,
  fallback: Value,
): Value {
  return options.find((option) => option.value === raw)?.value ?? fallback;
}

/** Parse at the boundary: a stored record is user-writable data. */
export const appearanceSchema = storedAppearanceSchema.transform(
  (stored): Appearance => ({
    font: pick(EDITOR_FONTS, stored.font, APPEARANCE_DEFAULTS.font),
    size: pick(EDITOR_SIZES, stored.size, APPEARANCE_DEFAULTS.size),
    leading: pick(EDITOR_LEADINGS, stored.leading, APPEARANCE_DEFAULTS.leading),
    measure: pick(EDITOR_MEASURES, stored.measure, APPEARANCE_DEFAULTS.measure),
  }),
);

function cssOf<Value extends string>(
  options: readonly Option<Value>[],
  value: Value,
): string | null {
  return options.find((option) => option.value === value)?.css ?? null;
}

function setToken(root: HTMLElement, name: string, value: string | null): void {
  if (value === null) {
    root.style.removeProperty(name);
  } else {
    root.style.setProperty(name, value);
  }
}

/** The ONE place an appearance reaches the document. */
function applyAppearance(appearance: Appearance, root: HTMLElement): void {
  setToken(root, "--editor-font", cssOf(EDITOR_FONTS, appearance.font));
  setToken(root, "--editor-size", cssOf(EDITOR_SIZES, appearance.size));
  setToken(root, "--editor-line-height", cssOf(EDITOR_LEADINGS, appearance.leading));
  setToken(root, "--editor-width", cssOf(EDITOR_MEASURES, appearance.measure));
}

interface AppearanceContextValue {
  readonly appearance: Appearance;
  readonly setAppearance: (next: Appearance) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

/** Applies in a LAYOUT effect: the workspace route is client-only, so this runs
 *  before its first paint and the reader never sees the stylesheet default
 *  swapped out from under a rendered document. */
export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [appearance, setAppearanceState] = useState<Appearance>(readAppearance);

  useLayoutEffect(() => {
    applyAppearance(appearance, document.documentElement);
  }, [appearance]);

  const value = useMemo<AppearanceContextValue>(
    () => ({
      appearance,
      setAppearance: (next) => {
        writeAppearance(next);
        setAppearanceState(next);
      },
    }),
    [appearance],
  );

  return <AppearanceContext value={value}>{children}</AppearanceContext>;
}

export function useAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext);
  if (value === null) {
    throw new Error("useAppearance must be used within an <AppearanceProvider>");
  }
  return value;
}
