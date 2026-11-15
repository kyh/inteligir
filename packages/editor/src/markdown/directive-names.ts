// The directives the dialect reads, each named once: the plugins restore any other to the text it
// was written as, so the rules read these names and no other.

import { z } from "zod";

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
