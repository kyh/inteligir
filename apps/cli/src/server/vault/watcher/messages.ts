// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

// Wire protocol between the server parent and the parcel watcher child. Every
// payload must be structured-clone / JSON safe (no functions, no Error
// instances) — parcel events already are ({path, type}); errors travel as
// their message string.

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
      // Set when re-subscribing onto a freshly respawned child. The child
      // re-emits the root's current entries once the watch is armed so callers
      // reconcile against on-disk state and recover changes missed during the
      // restart gap.
      rescan: boolean;
    }
  | { kind: "unsubscribe"; id: string }
  | { kind: "ping"; nonce: number };

export type ChildToParentMessage =
  | { kind: "ready" }
  | { kind: "pong"; nonce: number }
  | { kind: "subscribed"; id: string }
  | { kind: "subscribe-failed"; id: string; message: string }
  | { kind: "unsubscribed"; id: string }
  | { kind: "events"; id: string; events: SerializedParcelEvent[] }
  | { kind: "watch-error"; id: string; message: string };

const serializedParcelEventSchema = z.object({
  path: z.string(),
  type: z.enum(["create", "update", "delete"]),
});

/** A batch keeps the entries it can read: one malformed event must not cost
 *  the watcher every other change delivered in the same message. */
const parcelEventBatchSchema = z.array(z.unknown()).transform((events) =>
  events.flatMap((event) => {
    const parsed = serializedParcelEventSchema.safeParse(event);
    return parsed.success ? [parsed.data] : [];
  }),
);

/** Only `ignore` crosses the fork; an entry that is not a path is dropped, and
 *  an `ignore` that is not a list reads as options carrying nothing. */
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
  .transform(
    ({ ignore }): ParcelWatcherSubscribeOptions => (ignore === undefined ? {} : { ignore }),
  );

/** node's IPC delivers an unparsed payload; both sides read one through these
 *  schemas instead of a cast. */
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
  z.object({ kind: z.literal("ping"), nonce: z.number() }),
]);

export const childToParentMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready") }),
  z.object({ kind: z.literal("pong"), nonce: z.number() }),
  z.object({ kind: z.literal("subscribed"), id: z.string() }),
  z.object({ kind: z.literal("unsubscribed"), id: z.string() }),
  z.object({ kind: z.literal("subscribe-failed"), id: z.string(), message: z.string() }),
  z.object({ kind: z.literal("watch-error"), id: z.string(), message: z.string() }),
  z.object({ kind: z.literal("events"), id: z.string(), events: parcelEventBatchSchema }),
]);
