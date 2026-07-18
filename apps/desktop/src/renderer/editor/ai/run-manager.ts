// Run/token lifecycle for the editor's AI menu. One editor surface, one run at
// a time — so the bookkeeping is module-level, exactly like the session it
// serves. A monotonic `token` fences async continuations: every cancel / close
// / new run bumps it, and a continuation that finds its token stale drops its
// result rather than touching an editor the user has moved on from. A streaming
// run also carries a host `requestId` (to filter its stream events and abort it
// host-side) plus the stream's unsubscribe handle.

import { getBridge } from "@renderer/lib/bridge";

// Bumped on every cancel / close / new run; continuations compare their captured
// token against isCurrent() before mutating the editor.
let runToken = 0;
// Monotonic per-run id source — pairs a run with the host for streaming + abort.
let runCounter = 0;
// The in-flight host requestId (for host-side abort), null when idle.
let activeRequestId: string | null = null;
// The active stream's unsubscribe, null when not streaming.
let streamOff: (() => void) | null = null;

export const runManager = {
  /** Start a new streaming / host run: invalidate any prior run, mint a fresh
   * requestId, and mark it in-flight. Returns the `token` that fences
   * continuations and the `requestId` used to filter stream events + abort. */
  begin(): { token: number; requestId: string } {
    const token = ++runToken;
    runCounter += 1;
    const requestId = `menu-${runCounter}`;
    activeRequestId = requestId;
    return { token, requestId };
  },

  /** Invalidate the current run without minting a streaming one — used by
   * close / accept and by the tokenless classify turn (which needs the fresh
   * token to fence its own continuation). Returns the new token. */
  bumpToken(): number {
    return ++runToken;
  },

  /** True while `token` still identifies the current run. */
  isCurrent(token: number): boolean {
    return runToken === token;
  },

  /** Record the active stream's unsubscribe handle. */
  setStream(off: () => void): void {
    streamOff = off;
  },

  /** Stop the active stream (idempotent). */
  stopStream(): void {
    streamOff?.();
    streamOff = null;
  },

  /** Clear the in-flight host requestId (the turn resolved on its own). */
  clearActive(): void {
    activeRequestId = null;
  },

  /** Supersession teardown shared by cancel + release: invalidate the run, stop
   * the stream, and abort the host-side turn if one is still in flight. */
  abort(): void {
    runToken += 1;
    streamOff?.();
    streamOff = null;
    if (activeRequestId !== null) {
      void getBridge().cancelInlineAi({ requestId: activeRequestId });
      activeRequestId = null;
    }
  },
};
