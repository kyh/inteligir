// The bridge carries what the page cannot ask its server: the loopback origin
// (a browser WebSocket cannot set a header and dials a different origin than
// the page, so main hands it over and attaches the bearer to the upgrade
// itself) and the updater, which lives in main because it replaces the app.
// Everything else rides the protocol handler, so the renderer never holds the
// token.

import { z } from "zod";
import type { UpdateState } from "./update-state";

export const IPC_CHANNELS = {
  SOCKET_ORIGIN: "desktop:socket-origin",
  UPDATE_STATE: "desktop:update-state",
  UPDATE_GET_STATE: "desktop:update-get-state",
  UPDATE_CHECK: "desktop:update-check",
  UPDATE_DOWNLOAD: "desktop:update-download",
  UPDATE_INSTALL: "desktop:update-install",
} as const;

export const socketOriginSchema = z.string().url();

// the preload parses every frame against update-state.ts before it reaches the page
export interface DesktopUpdatesBridge {
  getState(): Promise<UpdateState>;
  check(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  install(): Promise<UpdateState>;
  onState(listener: (state: UpdateState) => void): () => void;
}

export interface DesktopBridge {
  socketOrigin: string;
  updates: DesktopUpdatesBridge;
}

export function toErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
