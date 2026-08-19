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

// ---------------------------------------------------------------------------
// Handing a URL to the system browser
// ---------------------------------------------------------------------------

/**
 * How recently the page must have seen real input for a page-initiated URL to
 * reach `shell.openExternal`.
 *
 * Chromium's own popup blocking works off user activation; Electron exposes
 * none of it on `setWindowOpenHandler` or `will-navigate` (checked against
 * Electron 43's `HandlerDetails` — url, frameName, features, disposition,
 * referrer, postBody, and nothing about a gesture), so the shell tracks it
 * from `webContents`'s `input-event` and applies its own window. Without this,
 * a script loop calling `window.open` in the page becomes a loop of OS-level
 * browser launches — every one of them outside the origin pin, because the
 * pin's answer to an off-origin URL is exactly "hand it to the browser".
 */
export const USER_ACTIVATION_WINDOW_MS = 3_000;

export interface ExternalOpenDecision {
  allowed: boolean;
  /** Stated for the log line, because a silently dropped link reads as a bug. */
  reason: "allowed" | "not-http" | "no-user-activation";
}

export interface ExternalOpenArgs {
  url: string;
  /** `null` when the page has produced no input at all this session. */
  lastInputAt: number | null;
  now: number;
  windowMs?: number;
}

/**
 * May this page-initiated URL be opened in the system browser?
 *
 * Only http(s), and only while a user gesture is still recent. Menu items and
 * tray items do NOT go through this — a menu click IS the gesture, and it
 * produces no `input-event` in the page to measure.
 */
export function decideExternalOpen(args: ExternalOpenArgs): ExternalOpenDecision {
  if (!isHttpUrl(args.url)) {
    return { allowed: false, reason: "not-http" };
  }
  const windowMs = args.windowMs ?? USER_ACTIVATION_WINDOW_MS;
  if (args.lastInputAt === null || args.now - args.lastInputAt > windowMs) {
    return { allowed: false, reason: "no-user-activation" };
  }
  return { allowed: true, reason: "allowed" };
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/**
 * The ONE web permission this product uses: `media`, for the composer's
 * dictation microphone (issue #574). Electron's default is to grant most
 * permissions to whatever a window loads, so an unset handler is a standing
 * grant to whatever the window ends up rendering — the policy below is the
 * whole answer, and it denies everything not named here.
 *
 * A feature that needs another adds it to this set, deliberately, as one row.
 */
export const ALLOWED_PERMISSIONS: readonly string[] = ["media"];

/**
 * May `permission` be granted to a page from `requestingOrigin`, on a window
 * pinned to `appOrigin`?
 *
 * ORIGIN-SCOPED, not a bare allowlist, and that is the whole care this needs.
 * The origin pin already keeps the window on one origin, so a media request
 * can today only come from the app's own SPA — but a grant that ignored the
 * origin would be a standing one the day that stops being true (a subframe, a
 * future embed a note or an agent talked the window into). So `media` is
 * granted ONLY when the request comes from the window's own origin, and every
 * other permission is denied outright regardless of who asks.
 *
 * An empty `appOrigin` (a misconfigured shell) matches nothing:
 * `isSameOriginNavigation` fails closed, so the safe failure is "no
 * microphone" rather than "microphone for anyone".
 */
export function classifyPermission(
  permission: string,
  requestingOrigin: string,
  appOrigin: string,
): boolean {
  if (!ALLOWED_PERMISSIONS.includes(permission)) {
    return false;
  }
  return isSameOriginNavigation(requestingOrigin, appOrigin);
}
