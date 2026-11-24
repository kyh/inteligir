import { ITEM_FIELD_CAPS } from "@repo/contract/items/item-field-caps";
import { z } from "zod";

export const CAPTURE_HTML_MAX_CHARS = 2 * 1024 * 1024;

export const capturedPageSchema = z.strictObject({
  html: z.string().max(CAPTURE_HTML_MAX_CHARS).nullable(),
  title: z.string(),
  url: z.string().min(1).max(ITEM_FIELD_CAPS.url),
});

export type CapturedPage = z.infer<typeof capturedPageSchema>;
