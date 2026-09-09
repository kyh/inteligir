// the option that is the stylesheet's default carries `css: null`: the default is written
// once in `styles/globals.css`, and choosing it removes the inline property.

import { z } from "zod";

type EditorFont = "sans" | "serif" | "mono";
type EditorSize = "small" | "normal" | "large";
type EditorLeading = "tight" | "normal" | "relaxed";
type EditorMeasure = "narrow" | "normal" | "wide";

export interface Option<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly css: string | null;
}

export const EDITOR_FONTS: readonly Option<EditorFont>[] = [
  { css: null, label: "Sans", value: "sans" },
  { css: 'ui-serif, Charter, Georgia, "Times New Roman", serif', label: "Serif", value: "serif" },
  { css: "var(--font-code)", label: "Mono", value: "mono" },
];

export const EDITOR_SIZES: readonly Option<EditorSize>[] = [
  { css: "13px", label: "Small", value: "small" },
  { css: null, label: "Normal", value: "normal" },
  { css: "16px", label: "Large", value: "large" },
];

export const EDITOR_LEADINGS: readonly Option<EditorLeading>[] = [
  { css: "1.55", label: "Tight", value: "tight" },
  { css: null, label: "Normal", value: "normal" },
  { css: "1.95", label: "Relaxed", value: "relaxed" },
];

// ~59, ~70 and ~81 characters per line at the default size; the column's padding is inside the value.
export const EDITOR_MEASURES: readonly Option<EditorMeasure>[] = [
  { css: "32rem", label: "Narrow", value: "narrow" },
  { css: null, label: "Normal", value: "normal" },
  { css: "44rem", label: "Wide", value: "wide" },
];

export interface Appearance {
  readonly font: EditorFont;
  readonly size: EditorSize;
  readonly leading: EditorLeading;
  readonly measure: EditorMeasure;
}

export const APPEARANCE_DEFAULTS: Appearance = {
  font: "sans",
  leading: "normal",
  measure: "normal",
  size: "normal",
};

// oxlint-disable-next-line unicorn/no-useless-undefined, promise/valid-params, promise/prefer-await-to-then -- zod's catch, not a promise's: it takes the fallback positionally and a bare catch() is a type error
const storedString = z.catch(z.string().optional(), undefined);
// oxlint-disable-next-line promise/valid-params, promise/prefer-await-to-then -- zod's catch, not a promise's
const storedAppearanceSchema = z.catch(
  z.object({
    font: storedString,
    leading: storedString,
    measure: storedString,
    size: storedString,
  }),
  {},
);

const pick = <Value extends string>(
  options: readonly Option<Value>[],
  raw: string | undefined,
  fallback: Value,
): Value => options.find((option) => option.value === raw)?.value ?? fallback;

export const appearanceSchema = storedAppearanceSchema.transform((stored): Appearance => ({
  font: pick(EDITOR_FONTS, stored.font, APPEARANCE_DEFAULTS.font),
  leading: pick(EDITOR_LEADINGS, stored.leading, APPEARANCE_DEFAULTS.leading),
  measure: pick(EDITOR_MEASURES, stored.measure, APPEARANCE_DEFAULTS.measure),
  size: pick(EDITOR_SIZES, stored.size, APPEARANCE_DEFAULTS.size),
}));
