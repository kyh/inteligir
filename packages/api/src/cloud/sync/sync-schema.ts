import { z } from "zod";

// event bodies are opaque json: the cloud never interprets them, so the grammar evolves
// without a deploy. `deviceSeq` is strictly increasing per device; re-pushing a stored
// position with a byte-identical body is a duplicate, a different body is sync-conflict
// (so serialization must be stable), and a new position at or below the high-water mark is
// sync-out-of-order. a conflict aborts the rest of the batch; the accepted prefix stands.

export const SYNC_API_PATHS = {
  push: "/v1/sync/push",
  pull: "/v1/sync/pull",
} as const;

// desktop marks a dispatch: a phone may start it, an agent-capable desktop picks it up
export const threadLaneSchema = z.enum(["any", "desktop"]);
export type ThreadLane = z.infer<typeof threadLaneSchema>;

export const PUSH_MAX_EVENTS = 200;
export const PUSH_MAX_THREADS = 50;
// utf-8 bytes, not String.length's utf-16 units
export const EVENT_MAX_BYTES = 64 * 1024;

// for…of iterates code points, so a surrogate pair counts once, as its four bytes
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
    // the client's clock: keyed on server arrival time, a delayed retry would read as the newest fact
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type ThreadMetaInput = z.infer<typeof threadMetaInputSchema>;

export const pushRequestSchema = z
  .object({
    events: z.array(syncEventInputSchema).max(PUSH_MAX_EVENTS),
    threads: z.array(threadMetaInputSchema).max(PUSH_MAX_THREADS).optional(),
  })
  .strict();
export type PushRequest = z.infer<typeof pushRequestSchema>;

export const pushResponseSchema = z
  .object({
    accepted: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
    lastSeq: z.number().int().nonnegative(),
  })
  .strict();
export type PushResponse = z.infer<typeof pushResponseSchema>;

export const PULL_DEFAULT_LIMIT = 200;
export const PULL_MAX_LIMIT = 500;

export const pullQuerySchema = z.object({
  afterSeq: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(PULL_MAX_LIMIT).default(PULL_DEFAULT_LIMIT),
});
export type PullQuery = z.infer<typeof pullQuerySchema>;

// deviceId is server-stamped from the pushing credential, so no device can impersonate another
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
    lastSeq: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  })
  .strict();
export type PullResponse = z.infer<typeof pullResponseSchema>;
