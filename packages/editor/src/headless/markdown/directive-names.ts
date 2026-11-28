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

export const textDirectiveSchema = z.enum(["date", "formula", "highlight"]);

export type TextDirectiveName = z.infer<typeof textDirectiveSchema>;

export const formulaAttributesSchema = z.strictObject({
  name: z.string().refine(isPillName).optional(),
  source: z.string().min(1),
});
