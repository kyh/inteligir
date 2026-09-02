// A WebSocket can be neither proxied by the shell's protocol handler nor given
// a header, so it dials the loopback server directly — under the shell, a
// different origin from the page's.

import type { DesktopBridge } from "../../types";

declare global {
  interface Window {
    desktopBridge?: DesktopBridge;
  }
}

export function socketOrigin(): string {
  return window.desktopBridge?.socketOrigin ?? window.location.origin;
}
