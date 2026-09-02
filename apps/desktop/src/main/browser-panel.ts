// pure policy for browser-window.ts; no `electron` import so it stays unit-testable.

import { isHttpUrl } from "./origin-pin";

// `persist:` so logins survive a restart; its own name so cookies never share the app's partition.
export const BROWSER_PARTITION = "persist:inteligir-browser";

// must not collide with the app's ⌘K/P/D/\ or the editor's ⌘E/G/T/L(+⇧)/⌘⇧A/⌘⇧C.
export const BROWSER_ACCELERATOR = "CmdOrCtrl+Shift+B";

export const BROWSER_CHROME_HEIGHT = 44;

export const BROWSER_HOME_URL = "https://duckduckgo.com/";

// anything not http(s) after resolution becomes a search: the URL bar must never launch `file:`/`javascript:`.
export function resolveAddressInput(raw: string): string | null {
  const text = raw.trim();
  if (text.length === 0) {
    return null;
  }
  if (isHttpUrl(text)) {
    return text;
  }
  if (!/\s/.test(text) && text.includes(".")) {
    const candidate = `https://${text}`;
    if (isHttpUrl(candidate)) {
      return candidate;
    }
  }
  const query = encodeURIComponent(text);
  return `https://duckduckgo.com/?q=${query}`;
}

export type BrowserNavigationVerdict = "allow" | "block";

export function classifyBrowserNavigation(targetUrl: string): BrowserNavigationVerdict {
  return isHttpUrl(targetUrl) ? "allow" : "block";
}

// the popup is always denied; an http(s) target navigates the content view in place instead.
export type BrowserWindowOpenVerdict = "deny-and-navigate" | "deny";

export function classifyBrowserWindowOpen(url: string): BrowserWindowOpenVerdict {
  return isHttpUrl(url) ? "deny-and-navigate" : "deny";
}

// no preload: the content view renders the open web and must never reach ipcRenderer.
export function contentViewWebPreferences() {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    partition: BROWSER_PARTITION,
  } as const;
}

export function chromeViewWebPreferences(preloadPath: string) {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    preload: preloadPath,
  } as const;
}

export const CAPTURE_SELECTION_MAX_CHARS = 20_000;

export interface PageCapture {
  url: string;
  title: string;
  selection: string;
}

// stays under the thread-title schema's 200-char cap.
export function capturePageTitle(capture: PageCapture): string {
  const title = capture.title.trim();
  const base = title.length > 0 ? title : capture.url;
  return `Page: ${base}`.slice(0, 180);
}

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
