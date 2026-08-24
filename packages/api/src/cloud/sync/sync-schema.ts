import { z } from "zod";

// ---------------------------------------------------------------------------
// Thread sync: an append-only MERGED event log per account, in that user's
// ThreadSyncDO. Devices push outbox batches keyed by their own per-device
// counter; the server assigns one global `seq` across all devices, which is
// the only cursor a client ever pages by. Event BODIES are opaque JSON here on
// purpose: the cloud stores and fans out, it never interprets — the ThreadEvent
// grammar lives in @repo/domain and evolves without a cloud deploy.
//
// THE OUTBOX CONTRACT, in full, because a client that gets it wrong is told so
// rather than silently losing writes:
//   • `deviceSeq` is strictly increasing per device, across batches. Within a
//     batch it must be sorted; a batch that is not is refused whole.
//   • Re-pushing a position ALREADY stored is the retry path and is accepted as
//     a duplicate — but only when the body is byte-identical to what was
//     stored. A different body at the same position is `sync-conflict`: the
//     outbox is buggy, and swallowing it would be data loss wearing
//     idempotency's clothes. Serialization must therefore be stable — the same
//     value with reordered keys reads as a different body.
//   • A NEW position at or below the device's high-water mark is
//     `sync-out-of-order`: accepting it would hand an older event a newer
//     global seq and reverse causality for every reader.
// A conflict aborts the rest of the batch; the prefix already accepted stands
// and re-pushes cleanly.
// ---------------------------------------------------------------------------

/**
 * Which device class a thread's work is addressed to. `desktop` marks a thread
 * as a dispatch: a phone can start it, but an agent-capable desktop is the one
 * expected to pick it up (the ws `dispatch` ping targets desktop sockets).
 */
/** Where the merged log is served — see `DEVICE_API_PATHS` for why a path
 *  lives beside its schemas. */
export const SYNC_API_PATHS = {
  push: "/v1/sync/push",
  pull: "/v1/sync/pull",
} as const;

export const threadLaneSchema = z.enum(["any", "desktop"]);
export type ThreadLane = z.infer<typeof threadLaneSchema>;

export const PUSH_MAX_EVENTS = 200;
export const PUSH_MAX_THREADS = 50;
/** Per-event ceiling on the serialized body, in UTF-8 BYTES — what storage and
 * the wire actually spend, which `String.length`'s UTF-16 units are not. */
export const EVENT_MAX_BYTES = 64 * 1024;

/**
 * True once `value` exceeds `limit` UTF-8 BYTES. Counted rather than encoded,
 * for two reasons: this package assumes no platform globals (so `TextEncoder`
 * is not available to it), and a ceiling is a refusal threshold — stopping at
 * the moment it is crossed beats allocating an encoded copy of every body that
 * passes. `for…of` iterates CODE POINTS, so a surrogate pair counts once, as
 * the four bytes it actually is.
 */
function exceedsUtf8Bytes(value: string, limit: number): boolean {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (bytes > limit) return true;
  }
  return false;
}

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
  .refine((value) => !exceedsUtf8Bytes(JSON.stringify(value.event), EVENT_MAX_BYTES), {
    message: `event body exceeds ${EVENT_MAX_BYTES} bytes`,
    path: ["event"],
  });
export type SyncEventInput = z.infer<typeof syncEventInputSchema>;

export const threadMetaInputSchema = z
  .object({
    threadId: z.string().min(1).max(128),
    lane: threadLaneSchema,
    title: z.string().max(200).optional(),
    /** When the CLIENT last changed this row, on its own clock. The server
     * keeps the newest and drops the rest, so a delayed retry cannot overwrite
     * a lane or title someone has since moved on from — last-writer-wins needs
     * a writer's timestamp, and the server's own arrival time makes the LATE
     * retry look like the newest fact. */
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type ThreadMetaInput = z.infer<typeof threadMetaInputSchema>;

// POST /v1/sync/push (device-authed).
export const pushRequestSchema = z
  .object({
    events: z.array(syncEventInputSchema).max(PUSH_MAX_EVENTS),
    /** Lane/title upserts riding the same batch — a dispatch is one push:
     * the thread row and its first events arrive together. A push carrying
     * ONLY these is legal, and still pokes the lane's sockets. */
    threads: z.array(threadMetaInputSchema).max(PUSH_MAX_THREADS).optional(),
  })
  .strict();
export type PushRequest = z.infer<typeof pushRequestSchema>;

export const pushResponseSchema = z
  .object({
    accepted: z.number().int().nonnegative(),
    /** Positions already stored with a byte-identical body — the retry path. */
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
