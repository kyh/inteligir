// ---------------------------------------------------------------------------
// inteligir:// — the Electron-only OS glue for the deep-link scheme. NO
// parsing or policy here: raw URL strings are buffered until the host is up,
// then handed to @repo/server' deliverDeepLink (which owns the rate limit,
// the grammar, and every security guard). Three OS delivery paths funnel
// through handleDeepLinkUrl:
//   - macOS: app.on("open-url") — can fire BEFORE `ready`, so the listener
//     installs at module load (like registerVaultAppScheme).
//   - win/linux, app running: the URL rides the SECOND instance's argv,
//     forwarded by the second-instance handler in index.ts.
//   - win/linux, cold launch: the URL rides OUR OWN argv, scanned in
//     onAppReady.
// Registration is PACKAGED-ONLY: setAsDefaultProtocolClient from a dev
// electron binary would steal the scheme from the user's installed app.
// ---------------------------------------------------------------------------

import { app } from "electron";

const DEEP_LINK_SCHEME = "inteligir";

// URLs that arrived before markDeepLinksReady (cold launch: open-url fires
// while the host is still booting). Flushed in arrival order.
const pendingUrls: string[] = [];
let deliver: ((url: string) => void) | null = null;

/** Buffer-or-deliver one raw deep-link URL. Safe to call at any lifecycle
 * point — that's the whole reason it exists. */
export function handleDeepLinkUrl(url: string): void {
  if (deliver !== null) deliver(url);
  else pendingUrls.push(url);
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

/** Wire the real dispatcher once the host has started, flushing everything
 * that arrived during boot. */
export function markDeepLinksReady(deliverFn: (url: string) => void): void {
  deliver = deliverFn;
  for (const url of pendingUrls.splice(0)) deliverFn(url);
}

/** The first inteligir:// URL on an argv, or null — the win/linux delivery
 * (second-instance and cold-launch argv both carry it). */
export function extractDeepLinkFromArgv(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith(`${DEEP_LINK_SCHEME}://`)) ?? null;
}
