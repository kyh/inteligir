import { z } from "zod";

// the bearer rides the upgrade header, and there is no browser cookie path, so no ticket
// machinery. invalidation only: state never rides the socket, a missed ping costs staleness.

export const SYNC_WS_PATH = "/v1/sync/ws";

// a delivery hint for dispatch targeting, never a capability: every socket may pull everything
export const SYNC_WS_PLATFORM_PARAM = "platform";
export const devicePlatformSchema = z.enum(["desktop", "mobile", "other"]);
export type DevicePlatform = z.infer<typeof devicePlatformSchema>;

// a Mac that takes a phone's requests says so on its upgrade, and only those Macs are pinged for a
// phone's turn or counted as listening to the phone. a hint like the platform: a socket's tags are
// fixed when it is accepted, so the Mac dials again when the choice changes.
export const SYNC_WS_PHONE_REQUESTS_PARAM = "phoneRequests";
export const SYNC_WS_PHONE_REQUESTS_ON = "on";

// what a client's upgrade says of it. `other` is only what the cloud makes of an unreadable hint.
export type SocketListener =
  | { platform: "desktop"; phoneRequests: boolean }
  | { platform: "mobile" };

// the durable object answers the literal pong by auto-response, without waking from hibernation
export const SYNC_WS_KEEPALIVE_PING = "ping";
export const SYNC_WS_KEEPALIVE_PONG = "pong";

// rfc 6455 policy violation: the cloud closes a revoked device's sockets with it. a hint, never
// the verdict: the client answers it with an http pass, and that pass's refusal is what ends it.
export const SYNC_WS_REVOKED_CLOSE_CODE = 1008;

// sync and vault are not sent to the pushing device's own sockets. dispatch says the dispatch
// inbox holds something for the thread: a phone's turn, to the sockets of Macs that take one; an answer, to the
// sockets of the Mac that asked; an approval, to mobile sockets. every frame is bare: the pull,
// the claim or the listing carries the state.
export const syncPingSchema = z.discriminatedUnion("type", [
  z.object({
    seq: z.number().int().nonnegative(),
    type: z.literal("sync"),
  }),
  z.object({
    type: z.literal("capture"),
  }),
  z.object({
    threadId: z.string().min(1),
    type: z.literal("dispatch"),
  }),
  z.object({
    type: z.literal("vault"),
  }),
]);
export type SyncPing = z.infer<typeof syncPingSchema>;
