// ---------------------------------------------------------------------------
// deliverDeepLink — the host-side dispatcher every raw inteligir:// URL
// funnels through (open-url, second-instance argv, cold-launch argv; the
// Electron glue in main/deep-link.ts hands raw strings here, no parsing
// there). A world-invokable surface, so the guards stack: a token-bucket
// rate limit (burst 10, refill 1 per 2s) in front of the pure parser's own
// caps + sanitizer, excess dropped and logged. Captures go to the durable
// inbox (CaptureManager); nav verbs broadcast onDeepLinkNav AND park as the
// pending nav a freshly-mounted renderer pulls (queue-then-pull — no
// connection-state tracking), then focus the window (that's their purpose;
// captures deliberately never steal focus).
// ---------------------------------------------------------------------------

import { getCaptureManager } from "./capture-manager";
import { emitEvent } from "../events";
import { parseDeepLink, type CaptureKind, type DeepLinkNavEvent } from "@repo/features/deep-link";

/** Token bucket: how many URLs may land in a burst… */
const BUCKET_CAPACITY = 10;
/** …and how long each replacement token takes (1 per 2s). */
const REFILL_INTERVAL_MS = 2_000;
/** A parked nav older than this is stale — a remounting renderer (crash
 * reload minutes later) must not replay an old navigation. Cold launches
 * mount the renderer well inside the window. */
const PENDING_NAV_TTL_MS = 60_000;

export type DeepLinkServiceDeps = {
  enqueueCapture: (kind: CaptureKind, text: string) => void;
  emitNav: (event: DeepLinkNavEvent) => void;
  /** Clock (ms) — injected so the rate limit + TTL are testable. */
  now: () => number;
};

export type DeepLinkService = {
  deliver: (rawUrl: string) => void;
  takePendingNav: () => DeepLinkNavEvent | null;
  setFocusHandler: (fn: (() => void) | null) => void;
};

export function createDeepLinkService(deps: DeepLinkServiceDeps): DeepLinkService {
  let tokens = BUCKET_CAPACITY;
  let lastRefill = deps.now();
  let pendingNav: { event: DeepLinkNavEvent; at: number } | null = null;
  let focusHandler: (() => void) | null = null;
  let navSeq = 0;

  function takeToken(): boolean {
    const now = deps.now();
    const refilled = Math.floor((now - lastRefill) / REFILL_INTERVAL_MS);
    if (refilled > 0) {
      tokens = Math.min(BUCKET_CAPACITY, tokens + refilled);
      lastRefill += refilled * REFILL_INTERVAL_MS;
    }
    if (tokens <= 0) return false;
    tokens -= 1;
    return true;
  }

  return {
    deliver(rawUrl: string): void {
      if (!takeToken()) {
        console.warn(`[deep-link] rate limit exceeded — dropped: ${rawUrl.slice(0, 128)}`);
        return;
      }
      const action = parseDeepLink(rawUrl);
      if (action === null) {
        console.warn(`[deep-link] rejected URL outside the grammar: ${rawUrl.slice(0, 128)}`);
        return;
      }
      if (action.kind === "capture") {
        deps.enqueueCapture(action.capture, action.text);
        return;
      }
      navSeq += 1;
      const event: DeepLinkNavEvent = { id: `nav-${navSeq}`, nav: action.nav };
      pendingNav = { event, at: deps.now() };
      deps.emitNav(event);
      try {
        focusHandler?.();
      } catch (err) {
        console.warn("[deep-link] focus handler failed:", err);
      }
    },
    takePendingNav(): DeepLinkNavEvent | null {
      const parked = pendingNav;
      pendingNav = null;
      if (parked === null) return null;
      return deps.now() - parked.at <= PENDING_NAV_TTL_MS ? parked.event : null;
    },
    setFocusHandler(fn: (() => void) | null): void {
      focusHandler = fn;
    },
  };
}

// ---------------------------------------------------------------------------
// Live singleton — bound to the real inbox, event bus, and clock. Lazy like
// every other host singleton so import order can't observe a half-built one.
// ---------------------------------------------------------------------------

let instance: DeepLinkService | null = null;

function getService(): DeepLinkService {
  instance ??= createDeepLinkService({
    enqueueCapture: (kind, text) => {
      getCaptureManager().enqueue(kind, text);
    },
    emitNav: (event) => emitEvent("onDeepLinkNav", event),
    now: () => Date.now(),
  });
  return instance;
}

/** Dispatch one raw deep-link URL. The main process calls this with every
 * URL the OS hands it (buffered until the host started). */
export function deliverDeepLink(rawUrl: string): void {
  getService().deliver(rawUrl);
}

/** Pull-and-clear the parked nav (the renderer's on-mount cold-launch pull). */
export function takePendingDeepLinkNav(): DeepLinkNavEvent | null {
  return getService().takePendingNav();
}

/** Main supplies how nav verbs surface the window (show + focus). */
export function setDeepLinkFocusHandler(fn: (() => void) | null): void {
  getService().setFocusHandler(fn);
}
