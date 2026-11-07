// The wire between the phone editor page and the React Native screen that hosts it. Both ends ship
// in one binary, so it breaks freely: no version field, no negotiation. Every frame crosses as a
// JSON string and is parsed here by the end that receives it. The same page loads in one of two
// modes, named by its `init`: an item's editor over its blocks by id, which reads and writes the
// phone's replica in ops, or the headless page nothing shows, which reads a page the phone shares
// into an item and merges a block two devices changed, since the editor and the reader live only
// in the page.

import { z } from "zod";

import { annotationIdSchema } from "@repo/notes/annotations/store-schema";
import { blockHashSchema, libraryOpSchema } from "@repo/notes/library/block-ops";
import { ordSchema } from "@repo/notes/library/block-order";
import { libraryItemFieldsSchema, SHA256_HEX_RE } from "@repo/notes/library/library-item";
import { librarySectionSchema, storableBlockSchema } from "@repo/notes/library/library-nodes";
import { pageFactsSchema } from "@repo/page-reader/page-facts";

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

// an item as the phone's replica reads it: its fields and its blocks in reading order, each with
// the hash and the place a write's base names
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

// what the phone's replica made of an item page's write: queued for the cell, already true, no
// such item, a base that moved (with the item as it reads now), fields past the item's caps, or
// blocks of a body still to come
const itemWriteOutcomeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("queued") }),
  z.strictObject({ kind: z.literal("unchanged") }),
  z.strictObject({ kind: z.literal("missing") }),
  z.strictObject({ item: heldItemSchema, kind: z.literal("changed") }),
  z.strictObject({ fields: z.array(z.string()), kind: z.literal("invalid") }),
  z.strictObject({ kind: z.literal("waiting") }),
]);

// whether the phone queued a highlight's write
const queuedSchema = z.strictObject({ queued: z.boolean() });

// One row per question an item page asks.
const REQUEST_SCHEMAS = {
  // the item an item page shows, as the phone's replica reads it now; null for one it holds none of
  item: {
    payload: z.strictObject({ itemId: itemIdSchema }),
    result: z.strictObject({ item: heldItemSchema.nullable() }),
  },
  // the items a link can name
  linkTargets: {
    payload: noPayload,
    result: z.strictObject({ targets: z.array(linkTargetSchema) }),
  },
  // an item page's ops, each under the base it was computed from; the phone's replica queues them
  // for the cell, staging every file a block names that it keeps unsent
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
  // bytes a block is about to name (a picture pasted into the text), kept on the phone by their
  // sha and sent up ahead of the write that names them
  keepFile: {
    payload: fileBytesSchema,
    result: z.strictObject({ sha: shaSchema }),
  },
  // the highlights an item holds, queued ones among them, which its marked passages tint by
  highlightIds: {
    payload: z.strictObject({ itemId: itemIdSchema }),
    result: z.strictObject({ ids: z.array(annotationIdSchema) }),
  },
  // a highlight the editor just marked on the passage it anchors: its bare entry, beside the
  // markers the item's next write carries
  addHighlight: {
    payload: z.strictObject({
      id: annotationIdSchema,
      itemId: itemIdSchema,
      quote: z.string().min(1),
    }),
    result: queuedSchema,
  },
  // a note of blocks the editor moved out of the item it shows, or a link's new note, made in the
  // folder that item is in and queued for the cell
  createNote: {
    payload: z.strictObject({
      besideId: itemIdSchema,
      blocks: z.array(z.strictObject({ block: storableBlockSchema, ord: ordSchema })),
      title: z.string(),
    }),
    result: z.strictObject({ id: itemIdSchema }),
  },
  // the note on a highlight the item holds
  noteHighlight: {
    payload: z.strictObject({ id: annotationIdSchema, itemId: itemIdSchema, text: z.string() }),
    result: queuedSchema,
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

// what the reader made of a page: its facts and its article as the item's article blocks, in
// order, or why it read nothing (a page that broke the extractor)
const fillAnswerSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    article: z.array(z.strictObject({ block: storableBlockSchema, ord: ordSchema })),
    facts: pageFactsSchema,
    kind: z.literal("read"),
  }),
  z.strictObject({ kind: z.literal("failed"), reason: z.string() }),
]);
export type FillAnswer = z.infer<typeof fillAnswerSchema>;

// a page the phone fetched, as its bytes (base64, since the bridge carries strings) and the charset
// its answer declared: the reader decodes it as a browser would
const fillJobSchema = z.strictObject({
  base64: z.string(),
  charset: z.string().nullable(),
  // "description": a video's or a song's description is its article, when it has one
  prefer: z.enum(["article", "description"]),
  url: z.string(),
});
export type FillJob = z.infer<typeof fillJobSchema>;

// a block two devices changed: as the phone's write was computed from it, as the phone wrote it,
// and as the cell holds it now
const mergeSidesSchema = z.strictObject({
  base: storableBlockSchema,
  mine: storableBlockSchema,
  theirs: storableBlockSchema,
});
export type MergeSides = z.infer<typeof mergeSidesSchema>;

// the block merged, and whether the phone's lines were kept over the other device's change to them;
// null when the page could not merge it
const mergedSchema = z
  .strictObject({ block: storableBlockSchema, overlapped: z.boolean() })
  .nullable();
export type MergeAnswer = z.infer<typeof mergedSchema>;

export const pageFrameSchema = z.discriminatedUnion("type", [
  z.discriminatedUnion("kind", [
    requestFrame("addHighlight", REQUEST_SCHEMAS.addHighlight.payload),
    requestFrame("createNote", REQUEST_SCHEMAS.createNote.payload),
    requestFrame("highlightIds", REQUEST_SCHEMAS.highlightIds.payload),
    requestFrame("item", REQUEST_SCHEMAS.item.payload),
    requestFrame("keepFile", REQUEST_SCHEMAS.keepFile.payload),
    requestFrame("linkTargets", REQUEST_SCHEMAS.linkTargets.payload),
    requestFrame("noteHighlight", REQUEST_SCHEMAS.noteHighlight.payload),
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
  // the highlights a tap on a marked passage names, which the phone's sheet shows
  z.strictObject({
    ids: z.array(z.string().min(1)).min(1),
    nonce: nonceSchema,
    type: z.literal("showAnnotations"),
  }),
  // an item page has written what it holds and asks the native stack to open the item a link names
  z.strictObject({ itemId: itemIdSchema, nonce: nonceSchema, type: z.literal("openItem") }),
  // the answer to a `flush`: whether the open item's edits are all written
  z.strictObject({ id: idSchema, nonce: nonceSchema, ok: z.boolean(), type: z.literal("flushed") }),
  // the reader's answer to a `fillJob` with the same id
  z.strictObject({
    answer: fillAnswerSchema,
    id: idSchema,
    nonce: nonceSchema,
    type: z.literal("fillAnswer"),
  }),
  // the merge's answer to a `mergeJob` with the same id
  z.strictObject({
    id: idSchema,
    merged: mergedSchema,
    nonce: nonceSchema,
    type: z.literal("mergeAnswer"),
  }),
]);

export type PageFrame = z.infer<typeof pageFrameSchema>;

/** @internal */
export const nativeFrameSchema = z.discriminatedUnion("type", [
  z.discriminatedUnion("mode", [
    // an item's editor over its blocks, by its id, and the most one file can be, past which the
    // library takes none, so the page refuses a larger one before it reads a byte of it
    z.strictObject({
      fileMaxBytes: z.number().int().positive(),
      focus: z.enum(["title", "body"]).nullable(),
      itemId: itemIdSchema,
      mode: z.literal("item"),
      nonce: nonceSchema,
      type: z.literal("init"),
    }),
    // the page nothing shows: no editor, only `fillJob`s and `mergeJob`s
    z.strictObject({ mode: z.literal("headless"), nonce: nonceSchema, type: z.literal("init") }),
  ]),
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
  // the phone's replica moved: these items changed, or the whole library did; an item page reads
  // its item again when it is among them, and says so when its own write was merged into it
  // keeping its lines over another device's change to the same ones (`overlapped`)
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
  // read this page; answered by a `fillAnswer` with the same id
  z.strictObject({
    id: idSchema,
    job: fillJobSchema,
    nonce: nonceSchema,
    type: z.literal("fillJob"),
  }),
  // merge this block; answered by a `mergeAnswer` with the same id
  z.strictObject({
    id: idSchema,
    nonce: nonceSchema,
    sides: mergeSidesSchema,
    type: z.literal("mergeJob"),
  }),
]);

export type NativeFrame = z.infer<typeof nativeFrameSchema>;

export type PageInit = Extract<NativeFrame, { type: "init" }>;

export type ItemInit = Extract<PageInit, { mode: "item" }>;

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
