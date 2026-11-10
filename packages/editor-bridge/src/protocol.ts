// The wire between the phone editor page and the React Native screen that hosts it. Both ends ship
// in one binary, so it breaks freely: no version field, no negotiation. Every frame crosses as a
// JSON string and is parsed here by the end that receives it. The page draws an item by its id
// from the blocks the phone holds of it, and takes no edit.

import { z } from "zod";

import { libraryItemFieldsSchema, SHA256_HEX_RE } from "@repo/contract/library/library-item";
import { librarySectionSchema, storableBlockSchema } from "@repo/contract/library/library-nodes";

// Native reaches the page only by calling this, through `injectJavaScript`: a message event is
// one a child frame's `parent.postMessage` could forge too.
export const PAGE_RECEIVER = "__inteligirEditorReceive";

// minted by the native end for one page load, and carried by every frame after `init`, so a frame
// that did not come from the other end, or from an earlier load of it, is dropped
const nonceSchema = z.string().min(16);

const idSchema = z.number().int().nonnegative();

// an item a link can name: its id and the title it goes by now
const linkTargetSchema = z.strictObject({ id: z.string().min(1), title: z.string() });

// the bridge carries strings, so a file's bytes ride as base64 beside the media type the Blob is
// rebuilt with
const fileBytesSchema = z.strictObject({ base64: z.string(), mediaType: z.string().min(1) });

const noPayload = z.strictObject({});

const itemIdSchema = z.string().min(1);

const shaSchema = z.string().regex(SHA256_HEX_RE);

// an item as the phone holds it: its fields and its blocks in reading order, each in its section
const heldItemSchema = z.strictObject({
  blocks: z.array(z.strictObject({ block: storableBlockSchema, section: librarySectionSchema })),
  fields: libraryItemFieldsSchema,
});

// One row per question an item page asks.
const REQUEST_SCHEMAS = {
  // the item an item page shows, as the phone holds it now; null for one the library holds none of
  item: {
    payload: z.strictObject({ itemId: itemIdSchema }),
    result: z.strictObject({ item: heldItemSchema.nullable() }),
  },
  // the items a link can name
  linkTargets: {
    payload: noPayload,
    result: z.strictObject({ targets: z.array(linkTargetSchema) }),
  },
  // a file of the library by its sha, as the phone's file cache holds it or fetches it; null while
  // the phone can reach no copy of it
  readFile: {
    payload: z.strictObject({ sha: shaSchema }),
    result: z.strictObject({ file: fileBytesSchema.nullable() }),
  },
};

type RequestSchemas = typeof REQUEST_SCHEMAS;

export type RequestKind = keyof RequestSchemas;

export type RequestPayload<K extends RequestKind> = z.output<RequestSchemas[K]["payload"]>;

export type RequestResult<K extends RequestKind> = z.output<RequestSchemas[K]["result"]>;

// the same table typed per kind, so a lookup by a generic kind answers that kind's own shapes
type RequestTable = {
  readonly [K in RequestKind]: {
    readonly payload: z.ZodType<RequestPayload<K>>;
    readonly result: z.ZodType<RequestResult<K>>;
  };
};

export const REQUESTS: RequestTable = REQUEST_SCHEMAS;

const requestFrame = <K extends RequestKind, P extends RequestSchemas[K]["payload"]>(
  kind: K,
  payload: P,
) =>
  z.strictObject({
    id: idSchema,
    kind: z.literal(kind),
    nonce: nonceSchema,
    payload,
    type: z.literal("request"),
  });

export const pageFrameSchema = z.discriminatedUnion("type", [
  z.discriminatedUnion("kind", [
    requestFrame("item", REQUEST_SCHEMAS.item.payload),
    requestFrame("linkTargets", REQUEST_SCHEMAS.linkTargets.payload),
    requestFrame("readFile", REQUEST_SCHEMAS.readFile.payload),
  ]),
  // the receiver is installed and the page waits for `init`; it knows no nonce yet
  z.strictObject({ type: z.literal("ready") }),
  // the person followed a link: the native stack opens the item it names
  z.strictObject({ itemId: itemIdSchema, nonce: nonceSchema, type: z.literal("openItem") }),
]);

export type PageFrame = z.infer<typeof pageFrameSchema>;

/** @internal */
export const nativeFrameSchema = z.discriminatedUnion("type", [
  // the item the page draws, by its id
  z.strictObject({ itemId: itemIdSchema, nonce: nonceSchema, type: z.literal("init") }),
  // a result is parsed by the request it answers, which knows its kind
  z.discriminatedUnion("ok", [
    z.strictObject({
      id: idSchema,
      nonce: nonceSchema,
      ok: z.literal(true),
      result: z.unknown(),
      type: z.literal("response"),
    }),
    z.strictObject({
      error: z.string(),
      id: idSchema,
      nonce: nonceSchema,
      ok: z.literal(false),
      type: z.literal("response"),
    }),
  ]),
  // the library moved: these items changed, or the whole of it did; an item page reads its item
  // again when it is among them, and a link's title when another is
  z.strictObject({
    ids: z.array(itemIdSchema),
    nonce: nonceSchema,
    reset: z.boolean(),
    type: z.literal("itemChanged"),
  }),
]);

export type NativeFrame = z.infer<typeof nativeFrameSchema>;

export type ItemInit = Extract<NativeFrame, { type: "init" }>;

// a frame as its sender builds it, before the bridge stamps the load's nonce on it
export type Unstamped<F> = F extends { readonly nonce: string } ? Omit<F, "nonce"> : never;

// null for anything that is not a well-formed frame, a caller that passed no text included
const parseFrame = <T>(schema: z.ZodType<T>, text: string): T | null => {
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export const parsePageFrame = (text: string): PageFrame | null => parseFrame(pageFrameSchema, text);

export const parseNativeFrame = (text: string): NativeFrame | null =>
  parseFrame(nativeFrameSchema, text);

// What the native end hands `injectJavaScript`. The frame rides as a string literal of its JSON, as
// every frame does, so the page parses the one text it was handed; the trailing `true` is the
// result WKWebView wants from an injection.
export const nativeFrameScript = (frame: NativeFrame): string =>
  `window.${PAGE_RECEIVER}(${JSON.stringify(JSON.stringify(frame))});true;`;
