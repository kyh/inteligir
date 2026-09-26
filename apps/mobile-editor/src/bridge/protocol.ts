// The wire between the phone editor page and the React Native screen that hosts it. Both ends ship
// in one binary, so it breaks freely: no version field, no negotiation. Every frame crosses as a
// JSON string and is parsed here by the end that receives it.

import { z } from "zod";

import { commentIdSchema } from "@repo/notes/comments/sidecar-schema";
import { parseVaultPath } from "@repo/notes/knowledge/vault-path";

// Native reaches the page only by calling this, through `injectJavaScript`: a message event is
// one a child frame's `parent.postMessage` could forge too.
export const PAGE_RECEIVER = "__inteligirEditorReceive";

// the page and the native end address the same files, so a path either would normalize is refused
// rather than renamed
const vaultPathSchema = z.string().superRefine((value, ctx) => {
  const parsed = parseVaultPath(value);
  if (!parsed.ok) {
    ctx.addIssue({ code: "custom", message: parsed.message });
  } else if (parsed.path !== value) {
    ctx.addIssue({ code: "custom", message: "path must be already normal" });
  }
});

// minted by the native end for one page load, and carried by every frame after `init`, so a frame
// that did not come from the other end, or from an earlier load of it, is dropped
const nonceSchema = z.string().min(16);

const idSchema = z.number().int().nonnegative();

const themeSchema = z.enum(["system", "light", "dark"]);

const guardSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("absent") }).strict(),
  z.object({ base: z.string(), kind: z.literal("expected") }).strict(),
]);

const writtenSchema = z.object({ kind: z.literal("written") }).strict();
const changedSchema = z.object({ current: z.string(), kind: z.literal("changed") }).strict();
const missingSchema = z.object({ kind: z.literal("missing") }).strict();

const guardedWriteResultSchema = z.discriminatedUnion("kind", [
  writtenSchema,
  z.object({ kind: z.literal("exists") }).strict(),
  changedSchema,
  missingSchema,
]);

const renameResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }).strict(),
  z.object({ error: z.string(), ok: z.literal(false) }).strict(),
]);

const pickImageResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("picked"), path: vaultPathSchema }).strict(),
  z.object({ kind: z.literal("cancelled") }).strict(),
  z.object({ kind: z.literal("refused"), message: z.string() }).strict(),
]);

const wikiTargetSchema = z
  .object({
    aliases: z.array(z.string()).exactOptional(),
    id: z.string().min(1).exactOptional(),
    path: vaultPathSchema,
    pinned: z.boolean().exactOptional(),
    title: z.string(),
    type: z.enum(["doc", "asset"]),
  })
  .strict();

// the bridge carries strings, so bytes ride as base64 beside the media type the Blob is rebuilt with
const assetBytesSchema = z.object({ base64: z.string(), mediaType: z.string() }).strict();

const noPayload = z.object({}).strict();

// One row per question the page asks. The page's store is the phone's, so a create is `write` under
// the `absent` guard, as `GuardedVaultPort` spells it, and a note is read the same way whether it
// is the open one or one an embed shows.
const REQUEST_SCHEMAS = {
  // the open note's write under the `expected` guard, carrying a new comment on the text it
  // anchors: the phone lands the note and the comment's entry as one change set
  addComment: {
    payload: z
      .object({
        base: z.string(),
        content: z.string(),
        id: commentIdSchema,
        path: vaultPathSchema,
        text: z.string().min(1),
      })
      .strict(),
    result: z.discriminatedUnion("kind", [writtenSchema, changedSchema, missingSchema]),
  },
  list: {
    payload: noPayload,
    // files only; the page decides which are docs, through @repo/notes' one answer
    result: z.object({ paths: z.array(vaultPathSchema) }).strict(),
  },
  pickImage: { payload: noPayload, result: pickImageResultSchema },
  read: {
    payload: z.object({ path: vaultPathSchema }).strict(),
    result: z.object({ content: z.string() }).strict(),
  },
  readAsset: { payload: z.object({ path: vaultPathSchema }).strict(), result: assetBytesSchema },
  remove: { payload: z.object({ path: vaultPathSchema }).strict(), result: noPayload },
  rename: {
    payload: z.object({ from: vaultPathSchema, to: vaultPathSchema }).strict(),
    result: renameResultSchema,
  },
  wikiTargets: {
    payload: noPayload,
    result: z.object({ targets: z.array(wikiTargetSchema) }).strict(),
  },
  write: {
    // `base` is the text the write was computed from; the native end compares it with what its
    // store holds, the page's CAS
    payload: z.object({ content: z.string(), guard: guardSchema, path: vaultPathSchema }).strict(),
    result: guardedWriteResultSchema,
  },
  // native picks the folder, from the vault's attachments choice and the note the page has open
  writeAsset: {
    payload: assetBytesSchema.extend({ baseName: z.string().min(1) }).strict(),
    result: z.object({ path: vaultPathSchema }).strict(),
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
  z
    .object({
      id: idSchema,
      kind: z.literal(kind),
      nonce: nonceSchema,
      payload,
      type: z.literal("request"),
    })
    .strict();

const saveErrorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("vanished") }).strict(),
  z.object({ kind: z.literal("refused"), message: z.string() }).strict(),
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
  z.object({ type: z.literal("ready") }).strict(),
  // the note the page shows, which a rename moves; null once it was deleted elsewhere and the page
  // shows none
  z
    .object({ nonce: nonceSchema, path: vaultPathSchema.nullable(), type: z.literal("opened") })
    .strict(),
  z
    .object({
      dirty: z.boolean(),
      nonce: nonceSchema,
      saveError: saveErrorSchema.nullable(),
      type: z.literal("editorState"),
    })
    .strict(),
  // a save merged a change made elsewhere and kept this page's lines where both changed the same ones
  z
    .object({ nonce: nonceSchema, path: vaultPathSchema, type: z.literal("mergeConflict") })
    .strict(),
  z
    .object({
      ids: z.array(z.string().min(1)).min(1),
      nonce: nonceSchema,
      type: z.literal("showComments"),
    })
    .strict(),
  // the page has flushed and asks the native stack to open this note, which keeps the back gesture
  z.object({ nonce: nonceSchema, path: vaultPathSchema, type: z.literal("navigate") }).strict(),
  z
    .object({
      nonce: nonceSchema,
      path: vaultPathSchema,
      selection: z.string(),
      type: z.literal("askAgent"),
    })
    .strict(),
  z.object({ nonce: nonceSchema, tag: z.string().min(1), type: z.literal("showTag") }).strict(),
  // the answer to a `flush`: whether the open note's edits are all written
  z
    .object({ id: idSchema, nonce: nonceSchema, ok: z.boolean(), type: z.literal("flushed") })
    .strict(),
]);

export type PageFrame = z.infer<typeof pageFrameSchema>;

const vaultChangedEventSchema = z.discriminatedUnion("kind", [
  // a listing row moved; null paths is a change nobody could attribute, so every reader re-checks
  z.object({ kind: z.literal("files"), paths: z.array(vaultPathSchema).nullable() }).strict(),
  z.object({ kind: z.literal("content"), path: vaultPathSchema }).strict(),
]);

export const nativeFrameSchema = z.discriminatedUnion("type", [
  z
    .object({
      focus: z.enum(["title", "body"]).nullable(),
      nonce: nonceSchema,
      path: vaultPathSchema,
      theme: themeSchema,
      type: z.literal("init"),
    })
    .strict(),
  // a result is parsed by the request it answers, which knows its kind
  z.discriminatedUnion("ok", [
    z
      .object({
        id: idSchema,
        nonce: nonceSchema,
        ok: z.literal(true),
        result: z.unknown(),
        type: z.literal("response"),
      })
      .strict(),
    z
      .object({
        error: z.string(),
        id: idSchema,
        nonce: nonceSchema,
        ok: z.literal(false),
        type: z.literal("response"),
      })
      .strict(),
  ]),
  z
    .object({
      event: vaultChangedEventSchema,
      nonce: nonceSchema,
      type: z.literal("vaultChanged"),
    })
    .strict(),
  // write the open note's edits now (the screen is leaving, the app is backgrounding); answered by
  // a `flushed` frame with the same id
  z.object({ id: idSchema, nonce: nonceSchema, type: z.literal("flush") }).strict(),
  z.object({ nonce: nonceSchema, theme: themeSchema, type: z.literal("theme") }).strict(),
]);

export type NativeFrame = z.infer<typeof nativeFrameSchema>;

export type PageInit = Extract<NativeFrame, { type: "init" }>;

// What the native end hands `injectJavaScript`. The frame rides as a string literal of its JSON, as
// every frame does, so the page parses the one text it was handed; the trailing `true` is the
// result WKWebView wants from an injection.
export const nativeFrameScript = (frame: NativeFrame): string =>
  `window.${PAGE_RECEIVER}(${JSON.stringify(JSON.stringify(frame))});true;`;
