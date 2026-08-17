// THE ORIGIN PIN — the whole security surface of this process.
//
// The shell owns no vault, no agent and no index: the product runs at the
// local server this window points at, and everything here is the OS
// affordances a browser tab cannot give it. What the shell must never become
// is a browser. The window loads exactly ONE origin and stays on it, and no
// popup is ever granted — a shell that can be navigated anywhere is a browser
// carrying the user's session, wearing the product's chrome, and every link a
// note or an agent can write is a phishing surface inside it.
//
// No `electron` import: index.ts owns the webContents wiring (preventDefault,
// shell.openExternal, the window-open deny) and delegates every DECISION here,
// so the policy is unit-testable with no Electron environment at all.

/** http(s) and nothing else. `file:`, `javascript:`, custom schemes and
 *  `about:` are never handed to the system browser — an unparseable URL is not
 *  http either, so the check fails closed. */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Does `targetUrl` stay on the window's own origin?
 *
 * Compares true URL ORIGINS. A `startsWith` on `http://127.0.0.1:4664` would
 * also match `http://127.0.0.1:46640`, and one on a hostname would match
 * `…evil.com`. An empty `appOrigin` (a misconfigured shell) and unparseable
 * URLs are never same-origin: a window that can navigate nowhere is the safe
 * failure.
 */
export function isSameOriginNavigation(targetUrl: string, appOrigin: string): boolean {
  if (appOrigin.length === 0) {
    return false;
  }
  try {
    return new URL(targetUrl).origin === new URL(appOrigin).origin;
  } catch {
    return false;
  }
}

/** Verdict for a top-level navigation (`will-navigate`, `will-redirect`):
 *  same-origin proceeds, everything else is blocked, and an http(s) target is
 *  additionally handed to the system browser so the link still works. */
export type NavigationVerdict = "allow" | "block-and-open-external" | "block";

export function classifyNavigation(targetUrl: string, appOrigin: string): NavigationVerdict {
  if (isSameOriginNavigation(targetUrl, appOrigin)) {
    return "allow";
  }
  return isHttpUrl(targetUrl) ? "block-and-open-external" : "block";
}

/** Verdict for `window.open` / `target=_blank`. The popup itself is ALWAYS
 *  denied — the verdict only decides whether the URL also opens in the system
 *  browser. Deliberately ignores the loaded origin: the shell never grants a
 *  second window, not even to itself. */
export type WindowOpenVerdict = "deny-and-open-external" | "deny";

export function classifyWindowOpen(url: string): WindowOpenVerdict {
  return isHttpUrl(url) ? "deny-and-open-external" : "deny";
}
