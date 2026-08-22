// THE BROWSER PANEL'S POLICY — every decision the in-app browser window makes,
// pure and unit-testable, in the origin-pin discipline (no `electron` import;
// browser-window.ts owns the wiring and delegates every DECISION here).
//
// The browser is a SEPARATE shell-owned window, never a view inside the app
// window: the app window's origin pin survives verbatim, with no preload and
// no IPC, and everything below concerns only the browser window's two
// webContents — the shell's own chrome bar (bundled HTML, the one place a
// preload exists) and the web content view (no preload, no node, sandboxed,
// its own storage partition).

import { isHttpUrl } from "./origin-pin";

/**
 * The content view's storage partition. `persist:` so logins survive a
 * restart — but its OWN name, so cookies are isolated from the app origin's
 * partition (which follows the vault) and from the user's system browser.
 */
export const BROWSER_PARTITION = "persist:inteligir-browser";

/** Shell-owned chord for summoning the browser window. The app's own table
 *  claims plain-modifier letters only (⌘K/P/D/\) and the editor's batch is
 *  ⌘E/⌘G/⌘T/⌘L(+⇧)/⌘⇧A/⌘⇧C — ⌘⇧B collides with none of them. */
export const BROWSER_ACCELERATOR = "CmdOrCtrl+Shift+B";

/** The chrome bar's height in the browser window, in px. One constant shared
 *  by the layout code and the chrome page's own CSS-free sizing. */
export const BROWSER_CHROME_HEIGHT = 44;

export const BROWSER_HOME_URL = "https://duckduckgo.com/";

/**
 * What the user typed in the URL bar, resolved to a navigable URL, or null.
 *
 * A scheme-less entry with a dot or a known-host shape gets `https://`;
 * everything that still is not http(s) after that is refused — the URL bar
 * must never become a `file:`/`javascript:` launcher for the content view.
 * Refused entries fall back to a web search so typing words still answers.
 */
export function resolveAddressInput(raw: string): string | null {
  const text = raw.trim();
  if (text.length === 0) {
    return null;
  }
  if (isHttpUrl(text)) {
    return text;
  }
  // One-word entries with no dot read as a search, not a hostname.
  if (!/\s/.test(text) && text.includes(".")) {
    const candidate = `https://${text}`;
    if (isHttpUrl(candidate)) {
      return candidate;
    }
  }
  const query = encodeURIComponent(text);
  return `https://duckduckgo.com/?q=${query}`;
}

/**
 * Verdict for a top-level navigation inside the CONTENT view. Navigation is
 * the point of a browser, so http(s) is free; every other scheme is blocked —
 * `file:` reads the disk, `javascript:` runs in whatever page is loaded, and
 * custom schemes launch handlers.
 */
export type BrowserNavigationVerdict = "allow" | "block";

export function classifyBrowserNavigation(targetUrl: string): BrowserNavigationVerdict {
  return isHttpUrl(targetUrl) ? "allow" : "block";
}

/**
 * Verdict for `window.open` / `target=_blank` inside the content view. The
 * popup itself is ALWAYS denied — this shell never grants a second window —
 * but an http(s) target navigates the content view there instead, so links
 * that insist on a new tab still work, in place.
 */
export type BrowserWindowOpenVerdict = "deny-and-navigate" | "deny";

export function classifyBrowserWindowOpen(url: string): BrowserWindowOpenVerdict {
  return isHttpUrl(url) ? "deny-and-navigate" : "deny";
}

/**
 * The content view's webPreferences, as data so the test can pin every flag.
 * No preload and no node: the content view renders the open web, and the only
 * process that may talk to the shell is the shell's own chrome bar.
 */
export function contentViewWebPreferences() {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    partition: BROWSER_PARTITION,
  } as const;
}

/** The chrome bar's webPreferences: same lockdown, PLUS the one preload in
 *  this process — the bridge that exposes exactly the nav verbs. It loads a
 *  bundled file, so it needs no partition of its own. */
export function chromeViewWebPreferences(preloadPath: string) {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    preload: preloadPath,
  } as const;
}

// ---------------------------------------------------------------------------
// Send page to agent
// ---------------------------------------------------------------------------

/** Selections can be book-length; the capture is context, not an archive. */
export const CAPTURE_SELECTION_MAX_CHARS = 20_000;

export interface PageCapture {
  url: string;
  title: string;
  selection: string;
}

/** The action title the captured page creates, capped to the contract's
 *  thread-title budget by the caller's schema (200) with room to spare. */
export function capturePageTitle(capture: PageCapture): string {
  const title = capture.title.trim();
  const base = title.length > 0 ? title : capture.url;
  return `Page: ${base}`.slice(0, 180);
}

/**
 * The message an agent receives for "send page to agent": the page named
 * first, the selection quoted after — the same statement-about-the-past shape
 * the view context rides in, and like it, a statement rather than a grant.
 */
export function capturePageMessage(capture: PageCapture): string {
  const lines = [
    `The user sent this page from the in-app browser:`,
    ``,
    `Title: ${capture.title.trim().length > 0 ? capture.title.trim() : "(untitled)"}`,
    `URL: ${capture.url}`,
  ];
  const selection = capture.selection.trim();
  if (selection.length > 0) {
    const clipped =
      selection.length > CAPTURE_SELECTION_MAX_CHARS
        ? `${selection.slice(0, CAPTURE_SELECTION_MAX_CHARS)}\n[selection truncated]`
        : selection;
    lines.push(``, `Selected on the page:`, ``, `> ${clipped.split("\n").join("\n> ")}`);
  }
  return lines.join("\n");
}
