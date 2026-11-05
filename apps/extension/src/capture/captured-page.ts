// what the capture script answers from the page it was injected into, as the service worker reads
// it: the page shaped what came back, so it is parsed before anything reads it. zod stays out of
// the script itself, which imports this file for its types alone and is handed the caps.

import { ANNOTATION_QUOTE_MAX } from "@repo/notes/annotations/store-schema";
import { ITEM_FIELD_CAPS } from "@repo/notes/library/library-item";
import { z } from "zod";

// the rendered page's html past which the capture answers none and the save is the page's link,
// which the cloud reads; in UTF-16 units, as a string's length counts
export const CAPTURE_HTML_MAX_CHARS = 2 * 1024 * 1024;

export interface CaptureOptions {
  readonly htmlMaxChars: number;
  // a highlight's longest quote
  readonly selectionMaxChars: number;
  // a title's longest line
  readonly titleMaxChars: number;
}

export const CAPTURE_OPTIONS: CaptureOptions = {
  htmlMaxChars: CAPTURE_HTML_MAX_CHARS,
  selectionMaxChars: ANNOTATION_QUOTE_MAX,
  titleMaxChars: ITEM_FIELD_CAPS.line,
};

export const capturedPageSchema = z.strictObject({
  html: z.string().max(CAPTURE_HTML_MAX_CHARS).nullable(),
  selection: z.string().min(1).max(ANNOTATION_QUOTE_MAX).nullable(),
  title: z.string().max(ITEM_FIELD_CAPS.line),
  url: z.string().min(1).max(ITEM_FIELD_CAPS.url),
});
export type CapturedPage = z.infer<typeof capturedPageSchema>;
