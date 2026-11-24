import { ITEM_FIELD_CAPS } from "@repo/contract/items/item-field-caps";
import { z } from "zod";

import { CAPTURE_HTML_MAX_CHARS } from "./serialize-page";

export const capturedPageSchema = z.strictObject({
  html: z.string().max(CAPTURE_HTML_MAX_CHARS).nullable(),
  title: z.string(),
  url: z.string().min(1).max(ITEM_FIELD_CAPS.url),
});

export type CapturedPage = z.infer<typeof capturedPageSchema>;
