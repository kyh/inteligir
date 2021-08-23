import { createCss, StitchesCss } from "@stitches/react";
export type { StitchesVariants } from "@stitches/react";

export const stitches = createCss();

export type CSS = StitchesCss<typeof stitches>;

export const { css, styled, global, theme, keyframes, getCssString } = stitches;
