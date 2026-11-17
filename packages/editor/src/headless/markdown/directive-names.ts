// The directives the dialect reads, each named once: the plugins restore any other to the text it
// was written as, so the rules read these names and no other.

import { z } from "zod";

import { isPillName } from "@repo/editor/headless/formulas/expression";

export const containerDirectiveSchema = z.enum([
  "article",
  "column",
  "columns",
  "tab",
  "tabs",
  "toggle",
]);
export type ContainerDirectiveName = z.infer<typeof containerDirectiveSchema>;

export const textDirectiveSchema = z.enum(["date", "formula"]);
export type TextDirectiveName = z.infer<typeof textDirectiveSchema>;

// what a `:formula` says of its pill beside the display in its label: the source that display is
// derived from, and the name other pills read it by
export const formulaAttributesSchema = z.strictObject({
  name: z.string().refine(isPillName).optional(),
  source: z.string().min(1),
});
