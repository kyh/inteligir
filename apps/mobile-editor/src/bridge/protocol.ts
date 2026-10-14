// The wire between the phone editor page and the React Native screen that hosts it. Both ends ship
// in one binary, so it breaks freely: no version field, no negotiation. Every frame crosses as a
// JSON string and is parsed here by the end that receives it.

import { z } from "zod";

import { commentIdSchema } from "@repo/notes/comments/sidecar-schema";
import { normalVaultPathSchema } from "@repo/notes/knowledge/vault-path-schema";

// Native reaches the page only by calling this, through `injectJavaScript`: a message event is
// one a child frame's `parent.postMessage` could forge too.
export const PAGE_RECEIVER = "__inteligirEditorReceive";

// minted by the native end for one page load, and carried by every frame after `init`, so a frame
// that did not come from the other end, or from an earlier load of it, is dropped
const nonceSchema = z.string().min(16);

const idSchema = z.number().int().nonnegative();

const guardSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("absent") }),
  z.strictObject({ base: z.string(), kind: z.literal("expected") }),
]);

const writtenSchema = z.strictObject({ kind: z.literal("written") });
const changedSchema = z.strictObject({ current: z.string(), kind: z.literal("changed") });
const missingSchema = z.strictObject({ kind: z.literal("missing") });

const guardedWriteResultSchema = z.discriminatedUnion("kind", [
  writtenSchema,
  z.strictObject({ kind: z.literal("exists") }),
  changedSchema,
  missingSchema,
]);

const renameResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ error: z.string(), ok: z.literal(false) }),
]);

const pickImageResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("picked"), path: normalVaultPathSchema }),
  z.strictObject({ kind: z.literal("cancelled") }),
  z.strictObject({ kind: z.literal("refused"), message: z.string() }),
]);

const wikiTargetSchema = z.strictObject({
  aliases: z.array(z.string()).exactOptional(),
  id: z.string().min(1).exactOptional(),
  path: normalVaultPathSchema,
  pinned: z.boolean().exactOptional(),
  title: z.string(),
  type: z.enum(["doc", "asset"]),
});

// the bridge carries strings, so bytes ride as base64 beside the media type the Blob is rebuilt with
const assetBytesSchema = z.strictObject({ base64: z.string(), mediaType: z.string() });

const noPayload = z.strictObject({});

// One row per question the page asks. The page's store is the phone's, so a create is `write` under
// the `absent` guard, as `GuardedVaultPort` spells it, and a note is read the same way whether it
// is the open one or one an embed shows.
const REQUEST_SCHEMAS = {
  // the open note's write under the `expected` guard, carrying a new comment on the text it
  // anchors: the phone lands the note and the comment's entry as one change set
  addComment: {
    payload: z.strictObject({
      base: z.string(),
      content: z.string(),
      id: commentIdSchema,
      path: normalVaultPathSchema,
      text: z.string().min(1),
    }),
    result: z.discriminatedUnion("kind", [writtenSchema, changedSchema, missingSchema]),
  },
  list: {
    payload: noPayload,
    // files only; the page decides which are docs, through @repo/notes' one answer
    result: z.strictObject({ paths: z.array(normalVaultPathSchema) }),
  },
  pickImage: { payload: noPayload, result: pickImageResultSchema },
  read: {
    payload: z.strictObject({ path: normalVaultPathSchema }),
    result: z.strictObject({ content: z.string() }),
  },
  readAsset: {
    payload: z.strictObject({ path: normalVaultPathSchema }),
    result: assetBytesSchema,
  },
  remove: { payload: z.strictObject({ path: normalVaultPathSchema }), result: noPayload },
  rename: {
    payload: z.strictObject({ from: normalVaultPathSchema, to: normalVaultPathSchema }),
    result: renameResultSchema,
  },
  wikiTargets: {
    payload: noPayload,
    result: z.strictObject({ targets: z.array(wikiTargetSchema) }),
  },
  write: {
    // `base` is the text the write was computed from; the native end compares it with what its
    // store holds, the page's CAS
    payload: z.strictObject({
      content: z.string(),
      guard: guardSchema,
      path: normalVaultPathSchema,
    }),
    result: guardedWriteResultSchema,
  },
  // native picks the folder, from the vault's attachments choice and the note the page has open
  writeAsset: {
    payload: assetBytesSchema.extend({ baseName: z.string().min(1) }),
    result: z.strictObject({ path: normalVaultPathSchema }),
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

const saveErrorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("vanished") }),
  z.strictObject({ kind: z.literal("refused"), message: z.string() }),
]);

export const pageFrameSchema = z.discriminatedUnion("type", [
  z.discriminatedUnion("kind", [
    requestFrame("addComment", REQUEST_SCHEMAS.addComment.payload),
    requestFrame("list", REQUEST_SCHEMAS.list.payload),
    requestFrame("pickImage", REQUEST_SCHEMAS.pickImage.payload),
    requestFrame("read", REQUEST_SCHEMAS.read.payload),
    requestFrame("readAsset", REQUEST_SCHEMAS.readAsset.payload),
    requestFrame("remove", REQUEST_SCHEMAS.remove.payload),
    requestFrame("rename", REQUEST_SCHEMAS.rename.payload),
    requestFrame("wikiTargets", REQUEST_SCHEMAS.wikiTargets.payload),
    requestFrame("write", REQUEST_SCHEMAS.write.payload),
    requestFrame("writeAsset", REQUEST_SCHEMAS.writeAsset.payload),
  ]),
  // the receiver is installed and the page waits for `init`; it knows no nonce yet
  z.strictObject({ type: z.literal("ready") }),
  // the note the page shows, which a rename moves; null once it was deleted elsewhere and the page
  // shows none
  z.strictObject({
    nonce: nonceSchema,
    path: normalVaultPathSchema.nullable(),
    type: z.literal("opened"),
  }),
  // the note this page was opened on could not be read, so the page shows none until a fresh load
  // of it reads the note again
  z.strictObject({
    message: z.string(),
    nonce: nonceSchema,
    path: normalVaultPathSchema,
    type: z.literal("openFailed"),
  }),
  z.strictObject({
    dirty: z.boolean(),
    nonce: nonceSchema,
    saveError: saveErrorSchema.nullable(),
    type: z.literal("editorState"),
  }),
  z.strictObject({
    ids: z.array(z.string().min(1)).min(1),
    nonce: nonceSchema,
    type: z.literal("showComments"),
  }),
  // the page has flushed and asks the native stack to open this note, which keeps the back gesture
  z.strictObject({ nonce: nonceSchema, path: normalVaultPathSchema, type: z.literal("navigate") }),
  z.strictObject({
    nonce: nonceSchema,
    path: normalVaultPathSchema,
    selection: z.string(),
    type: z.literal("askAgent"),
  }),
  // the answer to a `flush`: whether the open note's edits are all written
  z.strictObject({ id: idSchema, nonce: nonceSchema, ok: z.boolean(), type: z.literal("flushed") }),
]);

export type PageFrame = z.infer<typeof pageFrameSchema>;

const vaultChangedEventSchema = z.discriminatedUnion("kind", [
  // a listing row moved; null paths is a change nobody could attribute, so every reader re-checks
  z.strictObject({ kind: z.literal("files"), paths: z.array(normalVaultPathSchema).nullable() }),
  z.strictObject({ kind: z.literal("content"), path: normalVaultPathSchema }),
]);

export const nativeFrameSchema = z.discriminatedUnion("type", [
  z.strictObject({
    focus: z.enum(["title", "body"]).nullable(),
    nonce: nonceSchema,
    path: normalVaultPathSchema,
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
  z.strictObject({
    event: vaultChangedEventSchema,
    nonce: nonceSchema,
    type: z.literal("vaultChanged"),
  }),
  // write the open note's edits now (the screen is leaving, the app is backgrounding); answered by
  // a `flushed` frame with the same id
  z.strictObject({ id: idSchema, nonce: nonceSchema, type: z.literal("flush") }),
  // what the note's comment ranges are drawn by: every thread its store holds, and which of them
  // are resolved; sent when the page opens the note and whenever the note or its store changes
  z.strictObject({
    knownIds: z.array(commentIdSchema),
    nonce: nonceSchema,
    path: normalVaultPathSchema,
    resolvedIds: z.array(commentIdSchema),
    type: z.literal("commentMeta"),
  }),
  // threads deleted on the phone, whose markers the page takes out of the open note and writes
  z.strictObject({
    ids: z.array(commentIdSchema).min(1),
    nonce: nonceSchema,
    type: z.literal("commentsRemoved"),
  }),
]);

export type NativeFrame = z.infer<typeof nativeFrameSchema>;

export type PageInit = Extract<NativeFrame, { type: "init" }>;

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
