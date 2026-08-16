import { z } from "zod";

// ---------------------------------------------------------------------------
// Thread sync: an append-only MERGED event log per account, in that user's
// ThreadSyncDO. Devices push outbox batches keyed by their own per-device
// counter; the server assigns one global `seq` across all devices, which is
// the only cursor a client ever pages by. Event BODIES are opaque JSON here on
// purpose: the cloud stores and fans out, it never interprets — the ThreadEvent
// grammar lives in @repo/domain and evolves without a cloud deploy.
// ---------------------------------------------------------------------------

/**
 * Which device class a thread's work is addressed to. `desktop` marks a thread
 * as a dispatch: a phone can start it, but an agent-capable desktop is the one
 * expected to pick it up (the ws `dispatch` ping targets desktop sockets).
 */
export const threadLaneSchema = z.enum(["any", "desktop"]);
export type ThreadLane = z.infer<typeof threadLaneSchema>;

export const PUSH_MAX_EVENTS = 200;
export const PUSH_MAX_THREADS = 50;
/** Per-event ceiling on the SERIALIZED body — a sync log frame, not a blob store. */
export const EVENT_MAX_BYTES = 64 * 1024;

export const syncEventInputSchema = z
  .object({
    threadId: z.string().min(1).max(128),
    /** The device's own outbox counter, strictly increasing per device.
     * Idempotency key: re-pushing (deviceSeq) after a lost response is a
     * counted duplicate, never a second row. */
    deviceSeq: z.number().int().nonnegative(),
    event: z.json(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict()
  .refine((value) => JSON.stringify(value.event).length <= EVENT_MAX_BYTES, {
    message: `event body exceeds ${EVENT_MAX_BYTES} bytes`,
    path: ["event"],
  });
export type SyncEventInput = z.infer<typeof syncEventInputSchema>;

export const threadMetaInputSchema = z
  .object({
    threadId: z.string().min(1).max(128),
    lane: threadLaneSchema,
    title: z.string().max(200).optional(),
  })
  .strict();
export type ThreadMetaInput = z.infer<typeof threadMetaInputSchema>;

// POST /v1/sync/push (device-authed).
export const pushRequestSchema = z
  .object({
    events: z.array(syncEventInputSchema).max(PUSH_MAX_EVENTS),
    /** Lane/title upserts riding the same batch — a dispatch is one push:
     * the thread row and its first events arrive together. */
    threads: z.array(threadMetaInputSchema).max(PUSH_MAX_THREADS).optional(),
  })
  .strict();
export type PushRequest = z.infer<typeof pushRequestSchema>;

export const pushResponseSchema = z
  .object({
    accepted: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
    /** The log's high-water mark after this push — what the ws `sync` ping
     * carries, so a client can tell a ping it already covers from news. */
    lastSeq: z.number().int().nonnegative(),
  })
  .strict();
export type PushResponse = z.infer<typeof pushResponseSchema>;

// GET /v1/sync/pull?afterSeq=&limit= (device-authed).
export const PULL_DEFAULT_LIMIT = 200;
export const PULL_MAX_LIMIT = 500;

/** Coercing: the two fields arrive as query strings. */
export const pullQuerySchema = z.object({
  afterSeq: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(PULL_MAX_LIMIT).default(PULL_DEFAULT_LIMIT),
});
export type PullQuery = z.infer<typeof pullQuerySchema>;

/** A merged-log row. `deviceId` is server-stamped from the pushing credential —
 * a client skips its own rows by it, and no device can impersonate another. */
export const syncEventRowSchema = z
  .object({
    seq: z.number().int().positive(),
    threadId: z.string().min(1),
    deviceId: z.string().min(1),
    deviceSeq: z.number().int().nonnegative(),
    event: z.json(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export type SyncEventRow = z.infer<typeof syncEventRowSchema>;

export const pullResponseSchema = z
  .object({
    events: z.array(syncEventRowSchema),
    /** The log's high-water mark — `events` being empty with `lastSeq` ahead of
     * the client's cursor cannot happen; equal means caught up. */
    lastSeq: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  })
  .strict();
export type PullResponse = z.infer<typeof pullResponseSchema>;
