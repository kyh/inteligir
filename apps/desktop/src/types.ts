// The IPC surface, in ONE module both halves import, so the two cannot drift:
// the channel names, the schema for every payload that crosses, and the type
// the preload is `satisfies`-checked against.
//
// THE BRIDGE CARRIES ONE FACT, and that is the whole design. The renderer
// reaches the server through the `inteligir://` protocol handler, which is
// same-origin and adds the device token in MAIN — so the renderer holds no
// credential and needs no verb for one. What it cannot get that way is a
// WEBSOCKET: a browser `WebSocket` cannot set a header and its URL names a
// different origin than the page, so main hands the renderer that origin here
// and attaches the bearer to the upgrade itself.

import { z } from "zod";

export const IPC_CHANNELS = {
  SOCKET_ORIGIN: "desktop:socket-origin",
} as const;

/** Parses IPC payloads in the sandboxed preload, where the renderer is
 *  untrusted; the values themselves always originate from the main process. */
export const socketOriginSchema = z.string().url();

export interface DesktopBridge {
  /**
   * Where the invalidation bus and the dictation stream are dialled —
   * `http://127.0.0.1:<bound port>`, which the renderer turns into a `ws://`
   * URL. Synchronous because it is known before the window loads, and a
   * renderer that had to await it would open its socket a round trip late.
   */
  socketOrigin: string;
}

export function toErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
