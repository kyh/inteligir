import { z } from "zod";

// ---------------------------------------------------------------------------
// The live-follow socket: `GET /v1/sync/ws`, authenticated by the device
// credential as a Bearer header ON THE UPGRADE. Native callers can set
// headers on a WebSocket dial; there is deliberately no browser cookie path,
// so the ticket machinery a cookie transport would force never exists here.
//
// The socket is INVALIDATION-ONLY, one direction. The server pushes small
// pings; the client answers every one of them with an HTTP pull/list — state
// never rides the socket, so a missed ping costs staleness until the next
// sync, never correctness.
// ---------------------------------------------------------------------------

export const SYNC_WS_PATH = "/v1/sync/ws";

/** Upgrade query param: which device class this socket is. A delivery hint for
 * `dispatch` targeting, never a capability — every socket may pull everything. */
export const SYNC_WS_PLATFORM_PARAM = "platform";
export const devicePlatformSchema = z.enum(["desktop", "mobile", "other"]);
export type DevicePlatform = z.infer<typeof devicePlatformSchema>;

/** Client keepalive: send the literal ping, the server answers the literal
 * pong without waking the hibernated object (WebSocket auto-response). */
export const SYNC_WS_KEEPALIVE_PING = "ping";
export const SYNC_WS_KEEPALIVE_PONG = "pong";

/**
 * Server→client frames.
 * - `sync`: the log grew past `seq` — pull if your cursor is behind it. Not
 *   sent to the pushing device's own sockets (it has what it pushed).
 * - `capture`: the capture inbox is non-empty — list and ack.
 * - `dispatch`: a desktop-lane thread landed new work; sent only to sockets
 *   whose platform is `desktop`. The mailbox poke that makes a phone-started
 *   thread run on the machine with the agent.
 * - `vault`: the hosted vault repo advanced — run a vault sync pass. Bare by
 *   design (the pull is what carries state), and not sent to the pushing
 *   device's own sockets, same as `sync`. Stale clients drop it unparsed.
 */
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
