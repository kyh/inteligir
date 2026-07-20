// ---------------------------------------------------------------------------
// Pure navigation/origin policy for the app window (#433). No electron
// import — index.ts owns the webContents wiring (preventDefault,
// shell.openExternal, the window-open deny) and delegates every DECISION
// here, so the policy is unit-testable without an Electron env.
//
// The app window loads exactly one origin: the electron-vite dev server in
// dev, or the packaged file:// bundle in production. Any top-level navigation
// away from it (a crafted link in a note, agent output, injected content) is
// a phishing surface inside the product chrome, so the window is pinned:
// navigation that stays on the loaded origin is allowed (HMR relies on this
// in dev) and everything else is blocked, with http(s) routed out to the
// system browser. Popups are never granted: window.open is always denied,
// http(s) targets opening in the system browser instead.
// ---------------------------------------------------------------------------

import { isHttpUrl } from "@repo/bridge/wire-helpers";

/**
 * Is `targetUrl` a navigation that stays on the window's loaded origin?
 *
 * http(s) compares true URL origins — a raw startsWith on a prefix like
 * "http://localhost:5173" would also match "http://localhost:5173.evil.com".
 * file: URLs all parse to the opaque origin "null", so the packaged bundle
 * is matched by exact URL (plus a "#fragment" suffix for in-page anchors).
 *
 * An empty `loadedUrl` (no load started yet) and unparseable URLs are never
 * same-origin — the guard fails closed.
 */
export function isSameOriginNavigation(targetUrl: string, loadedUrl: string): boolean {
  if (loadedUrl.length === 0) return false;
  let parsed: URL;
  let loaded: URL;
  try {
    parsed = new URL(targetUrl);
    loaded = new URL(loadedUrl);
  } catch {
    return false; // unparseable → not same origin
  }
  if (loaded.protocol === "file:") {
    return (
      parsed.protocol === "file:" &&
      (targetUrl === loadedUrl || targetUrl.startsWith(loadedUrl + "#"))
    );
  }
  return parsed.origin === loaded.origin;
}

/** Verdict for a top-level navigation (will-navigate / will-redirect):
 * same-origin proceeds; everything else is blocked, with http(s) targets
 * additionally handed to the system browser. */
export type NavigationVerdict = "allow" | "block-and-open-external" | "block";

export function classifyNavigation(targetUrl: string, loadedUrl: string): NavigationVerdict {
  if (isSameOriginNavigation(targetUrl, loadedUrl)) return "allow";
  return isHttpUrl(targetUrl) ? "block-and-open-external" : "block";
}

/** Verdict for window.open / target=_blank: the popup itself is ALWAYS
 * denied (the verdict only decides whether the URL also opens in the system
 * browser). Deliberately ignores the loaded origin — the app never grants a
 * second window, even to itself. */
export type WindowOpenVerdict = "deny-and-open-external" | "deny";

export function classifyWindowOpen(url: string): WindowOpenVerdict {
  return isHttpUrl(url) ? "deny-and-open-external" : "deny";
}
