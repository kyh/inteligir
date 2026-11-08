// The wire between the phone editor page and the React Native screen that hosts it. Both ends ship
// in one binary, so it breaks freely: no version field, no negotiation. Every frame crosses as a
// JSON string and is parsed here by the end that receives it. The page is an item's editor over its
// blocks by id, which reads the item from the library and writes it back in ops through the phone.

import { z } from "zod";

import { blockHashSchema, libraryOpSchema } from "@repo/notes/library/block-ops";
import { ordSchema } from "@repo/notes/library/block-order";
import { libraryItemFieldsSchema, SHA256_HEX_RE } from "@repo/notes/library/library-item";
import { librarySectionSchema, storableBlockSchema } from "@repo/notes/library/library-nodes";

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

// an item as the library holds it: its fields and its blocks in reading order, each with the hash
// and the place a write's base names
const heldItemSchema = z.strictObject({
  blocks: z.array(
    z.strictObject({
      block: storableBlockSchema,
      hash: blockHashSchema,
      ord: ordSchema,
      section: librarySectionSchema,
    }),
  ),
  // false while its body is still to come from the cloud
  bodyHeld: z.boolean(),
  fields: libraryItemFieldsSchema,
});

// what the library made of an item page's write: taken, already true, no such item, a base that
// moved (with the item as it reads now), fields past the item's caps, or a write that waits on a
// body still to come
const itemWriteOutcomeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("queued") }),
  z.strictObject({ kind: z.literal("unchanged") }),
  z.strictObject({ kind: z.literal("missing") }),
  z.strictObject({ item: heldItemSchema, kind: z.literal("changed") }),
  z.strictObject({ fields: z.array(z.string()), kind: z.literal("invalid") }),
  z.strictObject({ kind: z.literal("waiting") }),
]);

// One row per question an item page asks.
const REQUEST_SCHEMAS = {
  // the item an item page shows, as the library holds it now; null for one it holds none of
  item: {
    payload: z.strictObject({ itemId: itemIdSchema }),
    result: z.strictObject({ item: heldItemSchema.nullable() }),
  },
  // the items a link can name
  linkTargets: {
    payload: noPayload,
    result: z.strictObject({ targets: z.array(linkTargetSchema) }),
  },
  // an item page's ops, each under the base it was computed from, written to the library
  writeItem: {
    payload: z.strictObject({ itemId: itemIdSchema, ops: z.array(libraryOpSchema) }),
    result: itemWriteOutcomeSchema,
  },
  // a file of the library by its sha, as the phone's file cache holds it or fetches it; null while
  // the phone can reach no copy of it
  readFile: {
    payload: z.strictObject({ sha: shaSchema }),
    result: z.strictObject({ file: fileBytesSchema.nullable() }),
  },
  // bytes a block is about to name (a picture pasted into the text), sent up to the library by
  // their sha ahead of the write that names them
  keepFile: {
    payload: fileBytesSchema,
    result: z.strictObject({ sha: shaSchema }),
  },
  // a note of blocks the editor moved out of the item it shows, or a link's new note, made in the
  // folder that item is in
  createNote: {
    payload: z.strictObject({
      besideId: itemIdSchema,
      blocks: z.array(z.strictObject({ block: storableBlockSchema, ord: ordSchema })),
      title: z.string(),
    }),
    result: z.strictObject({ id: itemIdSchema }),
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
    requestFrame("createNote", REQUEST_SCHEMAS.createNote.payload),
    requestFrame("item", REQUEST_SCHEMAS.item.payload),
    requestFrame("keepFile", REQUEST_SCHEMAS.keepFile.payload),
    requestFrame("linkTargets", REQUEST_SCHEMAS.linkTargets.payload),
    requestFrame("readFile", REQUEST_SCHEMAS.readFile.payload),
    requestFrame("writeItem", REQUEST_SCHEMAS.writeItem.payload),
  ]),
  // the receiver is installed and the page waits for `init`; it knows no nonce yet
  z.strictObject({ type: z.literal("ready") }),
  z.strictObject({
    nonce: nonceSchema,
    // why the last write did not land, said in the person's words
    saveError: z.string().nullable(),
    type: z.literal("editorState"),
  }),
  // an item page has written what it holds and asks the native stack to open the item a link names
  z.strictObject({ itemId: itemIdSchema, nonce: nonceSchema, type: z.literal("openItem") }),
  // the answer to a `flush`: whether the open item's edits are all written
  z.strictObject({ id: idSchema, nonce: nonceSchema, ok: z.boolean(), type: z.literal("flushed") }),
]);

export type PageFrame = z.infer<typeof pageFrameSchema>;

/** @internal */
export const nativeFrameSchema = z.discriminatedUnion("type", [
  // an item's editor over its blocks, by its id; the most one file can be, past which the library
  // takes none, so the page refuses a larger one before it reads a byte of it; and whether the
  // phone has a connection, without which the library takes no edit
  z.strictObject({
    fileMaxBytes: z.number().int().positive(),
    focus: z.enum(["title", "body"]).nullable(),
    itemId: itemIdSchema,
    nonce: nonceSchema,
    online: z.boolean(),
    type: z.literal("init"),
  }),
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
  // again when it is among them, and says so when its own write was merged into it keeping its
  // lines over another device's change to the same ones (`overlapped`)
  z.strictObject({
    ids: z.array(itemIdSchema),
    nonce: nonceSchema,
    overlapped: z.array(itemIdSchema),
    reset: z.boolean(),
    type: z.literal("itemChanged"),
  }),
  // write the open item's edits now (the screen is leaving, the app is backgrounding); answered by
  // a `flushed` frame with the same id
  z.strictObject({ id: idSchema, nonce: nonceSchema, type: z.literal("flush") }),
  // the phone's connection came or went: without one the page takes no edit, and an edit the drop
  // caught is written once it is back
  z.strictObject({ nonce: nonceSchema, online: z.boolean(), type: z.literal("connection") }),
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
