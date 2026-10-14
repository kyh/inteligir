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

interface DialBinding {
  readonly token: `--editor-${string}`;
  readonly options: readonly Option<string>[];
}

const dialBindings = z.registry<DialBinding>();

// one row per dial: the stylesheet token it sets, its options, and what an unset or unknown stored
// value reads as
const dial = <Value extends string>(
  token: DialBinding["token"],
  options: readonly Option<Value>[],
  fallback: NoInfer<Value>,
) =>
  z
    .enum(options.map((option) => option.value))
    // oxlint-disable-next-line promise/prefer-await-to-then -- zod's catch, not a promise's
    .catch(fallback)
    .register(dialBindings, { options, token });

const dials = z.object({
  font: dial("--editor-font", EDITOR_FONTS, "sans"),
  leading: dial("--editor-line-height", EDITOR_LEADINGS, "normal"),
  measure: dial("--editor-width", EDITOR_MEASURES, "normal"),
  size: dial("--editor-size", EDITOR_SIZES, "normal"),
});

export type Appearance = z.infer<typeof dials>;

export const APPEARANCE_DEFAULTS: Appearance = dials.parse({});

// oxlint-disable-next-line promise/prefer-await-to-then -- zod's catch, not a promise's
export const appearanceSchema = dials.catch(APPEARANCE_DEFAULTS);

export interface AppearanceToken {
  readonly token: DialBinding["token"];
  // null leaves the stylesheet's default
  readonly css: string | null;
}

export const appearanceTokens = (appearance: Appearance): AppearanceToken[] => {
  const chosen: Readonly<Record<string, string>> = appearance;
  return Object.entries(dials.shape).flatMap(([name, schema]) => {
    const binding = dialBindings.get(schema);
    if (binding === undefined) {
      return [];
    }
    const option = binding.options.find((candidate) => candidate.value === chosen[name]);
    return [{ css: option?.css ?? null, token: binding.token }];
  });
};
