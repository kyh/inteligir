// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

// every payload must be structured-clone safe: no functions, no Error instances.

import { z } from "zod";

import type { ParcelWatcherSubscribeOptions } from "./parcel-backend";

export interface SerializedParcelEvent {
  path: string;
  type: "create" | "update" | "delete";
}

export type ParentToChildMessage =
  | {
      kind: "subscribe";
      id: string;
      dir: string;
      opts: ParcelWatcherSubscribeOptions | undefined;
      // on a respawned child the root's entries are re-emitted so callers recover changes
      // missed during the gap.
      rescan: boolean;
    }
  | { kind: "unsubscribe"; id: string }
  | { kind: "ping" };

export type ChildToParentMessage =
  | { kind: "ready" }
  | { kind: "pong" }
  | { kind: "subscribed"; id: string }
  | { kind: "subscribe-failed"; id: string; message: string }
  | { kind: "unsubscribed"; id: string }
  | { kind: "events"; id: string; events: SerializedParcelEvent[] }
  | { kind: "watch-error"; id: string; message: string };

const serializedParcelEventSchema = z.object({
  path: z.string(),
  type: z.enum(["create", "update", "delete"]),
});

// one malformed event must not cost the batch its other entries.
const parcelEventBatchSchema = z.array(z.unknown()).transform((events) =>
  events.flatMap((event) => {
    const parsed = serializedParcelEventSchema.safeParse(event);
    return parsed.success ? [parsed.data] : [];
  }),
);

const subscribeOptionsSchema = z
  .object({
    ignore: z
      .array(z.unknown())
      .optional()
      .catch(undefined)
      .transform((entries) =>
        entries?.flatMap((entry) => {
          const path = z.string().safeParse(entry);
          return path.success ? [path.data] : [];
        }),
      ),
  })
  .transform(({ ignore }): ParcelWatcherSubscribeOptions =>
    ignore === undefined ? {} : { ignore },
  );

export const parentToChildMessageSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("subscribe"),
      id: z.string(),
      dir: z.string(),
      rescan: z.boolean(),
      opts: subscribeOptionsSchema.optional().catch(undefined),
    })
    .transform(({ kind, id, dir, rescan, opts }) => ({ kind, id, dir, opts, rescan })),
  z.object({ kind: z.literal("unsubscribe"), id: z.string() }),
  z.object({ kind: z.literal("ping") }),
]);

export const childToParentMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready") }),
  z.object({ kind: z.literal("pong") }),
  z.object({ kind: z.literal("subscribed"), id: z.string() }),
  z.object({ kind: z.literal("unsubscribed"), id: z.string() }),
  z.object({ kind: z.literal("subscribe-failed"), id: z.string(), message: z.string() }),
  z.object({ kind: z.literal("watch-error"), id: z.string(), message: z.string() }),
  z.object({ kind: z.literal("events"), id: z.string(), events: parcelEventBatchSchema }),
]);
