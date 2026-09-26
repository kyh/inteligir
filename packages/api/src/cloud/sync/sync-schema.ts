import { z } from "zod";
import { exceedsUtf8Bytes } from "../bytes";

// event bodies are opaque json: the cloud never interprets them, so the grammar evolves
// without a deploy. `deviceSeq` is strictly increasing per device; re-pushing a stored
// position with a byte-identical body is a duplicate, a different body is sync-conflict
// (so serialization must be stable), and a new position at or below the high-water mark is
// sync-out-of-order. a conflict aborts the rest of the batch; the accepted prefix stands.

export const SYNC_API_PATHS = {
  pull: "/v1/sync/pull",
  push: "/v1/sync/push",
} as const;

export const PUSH_MAX_EVENTS = 200;
// 0.4.0 and older send each titled thread's lane and title beside the events. The Worker keeps no
// row for them, since the dispatch inbox carries what the lane was for, so they are accepted and
// dropped: refusing the key would refuse every push those installs make.
const STALE_THREADS_MAX = 50;
// utf-8 bytes, not String.length's utf-16 units
export const EVENT_MAX_BYTES = 64 * 1024;

export const syncEventInputSchema = z
  .object({
    createdAt: z.number().int().nonnegative(),
    deviceSeq: z.number().int().nonnegative(),
    event: z.json(),
    threadId: z.string().min(1).max(128),
  })
  .strict()
  .refine((value) => !exceedsUtf8Bytes(JSON.stringify(value.event), EVENT_MAX_BYTES), {
    message: `event body exceeds ${EVENT_MAX_BYTES} bytes`,
    path: ["event"],
  });
export type SyncEventInput = z.infer<typeof syncEventInputSchema>;

export const pushRequestSchema = z
  .object({
    events: z.array(syncEventInputSchema).max(PUSH_MAX_EVENTS),
    threads: z.array(z.unknown()).max(STALE_THREADS_MAX).optional(),
  })
  .strict();
// what this build sends; the schema also admits what a stale install sends
export type PushRequest = Omit<z.infer<typeof pushRequestSchema>, "threads">;

export const pushResponseSchema = z.object({
  accepted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  lastSeq: z.number().int().nonnegative(),
});
export type PushResponse = z.infer<typeof pushResponseSchema>;

export const PULL_DEFAULT_LIMIT = 200;
export const PULL_MAX_LIMIT = 500;

export const pullQuerySchema = z.object({
  afterSeq: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(PULL_MAX_LIMIT).default(PULL_DEFAULT_LIMIT),
});
export type PullQuery = z.infer<typeof pullQuerySchema>;

// deviceId is server-stamped from the pushing credential, so no device can impersonate another
export const syncEventRowSchema = z.object({
  createdAt: z.number().int().nonnegative(),
  deviceId: z.string().min(1),
  deviceSeq: z.number().int().nonnegative(),
  event: z.json(),
  seq: z.number().int().positive(),
  threadId: z.string().min(1),
});
export type SyncEventRow = z.infer<typeof syncEventRowSchema>;

export const pullResponseSchema = z.object({
  events: z.array(syncEventRowSchema),
  hasMore: z.boolean(),
  lastSeq: z.number().int().nonnegative(),
});
export type PullResponse = z.infer<typeof pullResponseSchema>;
