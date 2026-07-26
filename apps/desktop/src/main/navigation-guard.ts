// ---------------------------------------------------------------------------
// Pure navigation/origin policy for the app window. No electron
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

// ---------------------------------------------------------------------------
// PDF sub-frame content gate.
//
// The editor embeds a PDF in an UN-sandboxed iframe, unavoidably: Chromium
// blocks its native PDF viewer (a MimeHandler document) inside a frame with
// any sandbox token, so the alternative is no PDF embedding at all. The
// renderer decides what is a PDF from the URL's SHAPE (a `.pdf` suffix), which
// a server is free to disagree with — `https://evil.com/notes.pdf` answering
// `text/html` renders attacker markup in that un-sandboxed frame. It is
// cross-origin, so it cannot touch the app or the Bridge; the residual is
// convincing phishing inside the product's chrome.
//
// Main sees the real response, so the mismatch is checkable exactly where the
// renderer's guess can be confirmed. Deliberately narrow: it only judges
// sub-frames whose URL matches the SAME shape test the renderer used, so the
// html embeds (youtube, media) are never in scope.
// ---------------------------------------------------------------------------

/** The renderer's shape test (pdf-node.tsx's PDF_RE) — kept in lockstep. */
const PDF_URL_RE = /\.pdf(?:[?#]|$)/i;

/** Content types Chromium will hand to its PDF viewer. */
const PDF_CONTENT_TYPES = new Set(["application/pdf", "application/x-pdf"]);

export type FrameResponse = {
  readonly url: string;
  /** Electron's `details.resourceType` — only "subFrame" is judged. */
  readonly resourceType: string;
  /** The response's Content-Type, or undefined when the server sent none. */
  readonly contentType: string | undefined;
};

/**
 * Should this response be blocked as a PDF frame that isn't a PDF?
 *
 * A missing Content-Type is ALLOWED: Chromium sniffs those, plenty of static
 * hosts omit it for .pdf, and blocking them would break real embeds to buy
 * nothing — an attacker controls their own headers and would simply send none.
 * The gate exists to stop `text/html` rendering where a PDF was promised.
 */
export function isPdfFrameMismatch(response: FrameResponse): boolean {
  if (response.resourceType !== "subFrame") return false;
  if (!PDF_URL_RE.test(response.url)) return false;
  if (response.contentType === undefined) return false;
  const essence = response.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (essence === "") return false;
  return !PDF_CONTENT_TYPES.has(essence);
}
