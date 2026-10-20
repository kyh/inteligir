// the wire between the browser extension and `inteligir native-host`: plain z.objects, which strip
// what they do not know, so either end ignores a field the other added. it breaks only behind its
// own version (BROWSER_WIRE_VERSION, refused below BROWSER_WIRE_FLOOR), since the extension ships
// on the Web Store's cadence and the host adapts it to /local. zod alone: the extension reaches
// nothing else of the contract.

import { z } from "zod";

export const BROWSER_WIRE_VERSION = 1;

// the rendered page's html past which the extension sends null and the Mac fetches the url
export const CAPTURE_HTML_MAX_CHARS = 8 * 1024 * 1024;

const ITEM_FILE_BASE64_MAX = Math.ceil((10 * 1024 * 1024) / 3) * 4;

export const capturedPageWireSchema = z.object({
  html: z.string().max(CAPTURE_HTML_MAX_CHARS).nullable(),
  selection: z.object({ text: z.string().min(1).max(20_000) }).nullable(),
  title: z.string().max(2000),
  // the host's /local call validates it as a web url
  url: z.string().min(1).max(8192),
});
export type CapturedPageWire = z.infer<typeof capturedPageWireSchema>;

// the oldest version a host or an extension still answers; a peer below it is told to update
export const BROWSER_WIRE_FLOOR = 1;

export const browserSaveSchema = z.discriminatedUnion("target", [
  z.object({ keepCopy: z.boolean(), page: capturedPageWireSchema, target: z.literal("page") }),
  z.object({
    target: z.literal("link"),
    title: z.string().max(2000).nullable(),
    url: z.string().max(8192),
  }),
  z.object({
    src: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("url"), url: z.string().max(8192) }),
      z.object({
        base64: z.string().max(ITEM_FILE_BASE64_MAX),
        kind: z.literal("bytes"),
        mime: z.string().max(100),
      }),
    ]),
    target: z.literal("image"),
  }),
]);
export type BrowserSave = z.infer<typeof browserSaveSchema>;

export const browserHostRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), v: z.number().int() }),
  z.object({ save: browserSaveSchema, type: z.literal("save"), v: z.number().int() }),
  z.object({ type: z.literal("open-app"), v: z.number().int() }),
]);
export type BrowserHostRequest = z.infer<typeof browserHostRequestSchema>;

export const BROWSER_REFUSALS = [
  "not-set-up",
  "app-unavailable",
  "too-large",
  "unsupported-page",
  "update-app",
  "update-extension",
  "failed",
] as const;
// a reason this end never heard of reads as a plain failure, never as a parse error
// oxlint-disable-next-line promise/prefer-await-to-then -- zod's catch, not a promise's
export const browserRefusalSchema = z.enum(BROWSER_REFUSALS).catch("failed");
export type BrowserRefusal = z.infer<typeof browserRefusalSchema>;

export const browserHostReplySchema = z.discriminatedUnion("type", [
  z.object({
    appVersion: z.string(),
    library: z.string(),
    type: z.literal("hello"),
    v: z.number().int(),
  }),
  z.object({
    created: z.boolean(),
    path: z.string(),
    title: z.string(),
    type: z.literal("saved"),
    v: z.number().int(),
  }),
  z.object({ type: z.literal("opened"), v: z.number().int() }),
  z.object({
    detail: z.string(),
    reason: browserRefusalSchema,
    type: z.literal("refused"),
    v: z.number().int(),
  }),
]);
export type BrowserHostReply = z.infer<typeof browserHostReplySchema>;
