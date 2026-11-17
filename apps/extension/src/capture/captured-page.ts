// what the capture script answers from the page it was injected into, as the service worker reads
// it: the page shaped what came back, so it is parsed before anything reads it. zod stays out of
// the script itself, which imports this file for its types alone.

import { ITEM_FIELD_CAPS } from "@repo/contract/library/library-item";
import { z } from "zod";

import { CAPTURE_HTML_MAX_CHARS } from "./serialize-page";

export const capturedPageSchema = z.strictObject({
  html: z.string().max(CAPTURE_HTML_MAX_CHARS).nullable(),
  // as long as the page wrote it: a save clips it to a line (`fieldLine`)
  title: z.string(),
  url: z.string().min(1).max(ITEM_FIELD_CAPS.url),
});
export type CapturedPage = z.infer<typeof capturedPageSchema>;
