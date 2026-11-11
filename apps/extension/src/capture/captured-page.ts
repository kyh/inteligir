// what the capture script answers from the page it was injected into, as the service worker reads
// it: the page shaped what came back, so it is parsed before anything reads it. zod stays out of
// the script itself, which imports this file for its types alone and is handed the caps.

import { ITEM_FIELD_CAPS } from "@repo/contract/library/library-item";
import { z } from "zod";

// the rendered page's html past which the capture answers none and the save is the page's link,
// which the cloud reads; in UTF-16 units, as a string's length counts
const CAPTURE_HTML_MAX_CHARS = 2 * 1024 * 1024;

export interface CaptureOptions {
  readonly htmlMaxChars: number;
  // a title's longest line
  readonly titleMaxChars: number;
}

export const CAPTURE_OPTIONS: CaptureOptions = {
  htmlMaxChars: CAPTURE_HTML_MAX_CHARS,
  titleMaxChars: ITEM_FIELD_CAPS.line,
};

export const capturedPageSchema = z.strictObject({
  html: z.string().max(CAPTURE_HTML_MAX_CHARS).nullable(),
  title: z.string().max(ITEM_FIELD_CAPS.line),
  url: z.string().min(1).max(ITEM_FIELD_CAPS.url),
});
export type CapturedPage = z.infer<typeof capturedPageSchema>;
