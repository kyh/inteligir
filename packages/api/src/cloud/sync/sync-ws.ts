import { z } from "zod";

// the bearer rides the upgrade header, and there is no browser cookie path, so no ticket
// machinery. invalidation only: state never rides the socket, a missed ping costs staleness.

export const SYNC_WS_PATH = "/v1/sync/ws";

// a delivery hint for dispatch targeting, never a capability: every socket may pull everything
export const SYNC_WS_PLATFORM_PARAM = "platform";
export const devicePlatformSchema = z.enum(["desktop", "mobile", "other"]);
export type DevicePlatform = z.infer<typeof devicePlatformSchema>;

// the durable object answers the literal pong by auto-response, without waking from hibernation
export const SYNC_WS_KEEPALIVE_PING = "ping";
export const SYNC_WS_KEEPALIVE_PONG = "pong";

// sync and vault are not sent to the pushing device's own sockets; dispatch goes only to
// desktop-platform sockets. every frame is bare: the pull carries the state.
export const syncPingSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("sync"),
      seq: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("capture"),
    })
    .strict(),
  z
    .object({
      type: z.literal("dispatch"),
      threadId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("vault"),
    })
    .strict(),
]);
export type SyncPing = z.infer<typeof syncPingSchema>;
