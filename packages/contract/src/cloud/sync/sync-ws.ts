import { z } from "zod";

// the bearer rides the upgrade header, and there is no browser cookie path, so no ticket
// machinery. invalidation only: state never rides the socket, a missed ping costs staleness.

export const SYNC_WS_PATH = "/v1/sync/ws";

// the durable object answers the literal pong by auto-response, without waking from hibernation
export const SYNC_WS_KEEPALIVE_PING = "ping";
export const SYNC_WS_KEEPALIVE_PONG = "pong";

// rfc 6455 policy violation: the cloud closes a revoked device's sockets with it. a hint, never
// the verdict: the client answers it with a request under its credential, and that request's
// refusal is what ends it.
export const SYNC_WS_REVOKED_CLOSE_CODE = 1008;

// another device moved the hosted vault, and the pusher's own sockets are not told. the frame is
// bare: the vault's own read carries the state. a frame type this build does not know is no frame.
export const syncPingSchema = z.object({ type: z.literal("vault") });
export type SyncPing = z.infer<typeof syncPingSchema>;
