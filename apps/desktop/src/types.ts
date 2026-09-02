// The bridge carries one fact: a browser WebSocket cannot set a header and
// dials a different origin than the page, so main hands the renderer that
// origin and attaches the bearer to the upgrade itself. Everything else rides
// the protocol handler, so the renderer never holds the token.

import { z } from "zod";

export const IPC_CHANNELS = {
  SOCKET_ORIGIN: "desktop:socket-origin",
} as const;

export const socketOriginSchema = z.string().url();

export interface DesktopBridge {
  socketOrigin: string;
}

export function toErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
