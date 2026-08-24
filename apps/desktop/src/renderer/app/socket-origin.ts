// WHERE THE TWO WEBSOCKETS DIAL, which is the one address this page cannot
// derive from itself.
//
// Every other request goes to `window.location.origin` and is answered by
// whatever served the page: the server's own static route in a browser tab, or
// the shell's `inteligir://` protocol handler, which proxies it to the loopback
// server and attaches the device token in main. A WEBSOCKET can be neither
// proxied nor given a header, so it dials the server directly — and under the
// shell that is a DIFFERENT origin from the page's, handed across the bridge
// (`apps/desktop/src/types.ts` states why the bridge carries exactly this).

import type { DesktopBridge } from "../../types";

declare global {
  interface Window {
    /** Present only inside the Electron shell; a browser tab has no bridge. */
    desktopBridge?: DesktopBridge;
  }
}

export function socketOrigin(): string {
  return window.desktopBridge?.socketOrigin ?? window.location.origin;
}
