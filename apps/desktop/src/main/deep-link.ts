// ---------------------------------------------------------------------------
// inteligir:// — the Electron-only OS glue. No grammar here: raw URLs go
// straight to deep-link-route.ts, and the resulting hosted path is buffered
// until a window exists. Three OS delivery paths funnel through
// handleDeepLinkUrl:
//   - macOS: app.on("open-url") — can fire BEFORE `ready`, so the listener
//     installs at module load.
//   - win/linux, app running: the URL rides the SECOND instance's argv,
//     forwarded by the second-instance handler in index.ts.
//   - win/linux, cold launch: the URL rides OUR OWN argv, scanned in
//     onAppReady.
// Registration is PACKAGED-ONLY: setAsDefaultProtocolClient from a dev
// electron binary would steal the scheme from the user's installed app.
// ---------------------------------------------------------------------------

import { app } from "electron";

import { deepLinkPath, DEEP_LINK_SCHEME } from "@/main/deep-link-route";

// Paths that arrived before markDeepLinksReady (cold launch: open-url fires
// while the window is still being created). Flushed in arrival order.
const pendingPaths: string[] = [];
let deliver: ((path: string) => void) | null = null;

/** Buffer-or-deliver one raw deep-link URL. Safe to call at any lifecycle
 * point — that's the whole reason it exists. */
export function handleDeepLinkUrl(url: string): void {
  const path = deepLinkPath(url);
  if (path === null) return;
  if (deliver !== null) deliver(path);
  else pendingPaths.push(path);
}

/** Install the open-url listener + (packaged only) the OS registration.
 * MUST run at module load in the main entry: macOS delivers open-url for a
 * cold launch before app `ready`. */
export function installDeepLinks(): void {
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLinkUrl(url);
  });
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  }
}

/** Wire the real dispatcher once the window exists, flushing everything that
 * arrived during boot. */
export function markDeepLinksReady(deliverFn: (path: string) => void): void {
  deliver = deliverFn;
  for (const path of pendingPaths.splice(0)) deliverFn(path);
}
