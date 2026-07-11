// ---------------------------------------------------------------------------
// The shared "live host channel" effect: while the connection is `connected`,
// subscribe to a Bridge event stream and load the initial snapshot once, with
// an alive flag so a load resolving after teardown can't set state. Every
// reconnect re-runs it — a background suspend disposes the bridge (and its
// subscriptions), so each `connected` needs a fresh subscription and a reload
// to reconcile whatever happened while this device was away.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";

import type { Bridge } from "@repo/features/ipc-registry";
import { getHostBridge, useHostStatus } from "./connection";

export type HostChannelOptions<E, S> = {
  /** Subscribe to the live event stream; returns unsubscribe. */
  readonly subscribe: (bridge: Bridge, onEvent: (event: E) => void) => () => void;
  /** One-shot initial load on every (re)connect. */
  readonly load: (bridge: Bridge) => Promise<S>;
  readonly onEvent: (event: E) => void;
  readonly onLoad: (snapshot: S) => void;
};

export function useHostChannel<E, S>(options: HostChannelOptions<E, S>): void {
  const { status } = useHostStatus();
  // Latest-ref: the effect's lifetime is the CONNECTION's, not the render's —
  // inline callbacks at the call site must not retrigger it.
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    if (status !== "connected") return;
    const bridge = getHostBridge();
    if (bridge === null) return;
    let alive = true;
    const unsubscribe = latest.current.subscribe(bridge, (event) => {
      if (alive) latest.current.onEvent(event);
    });
    void (async () => {
      try {
        const snapshot = await latest.current.load(bridge);
        if (alive) latest.current.onLoad(snapshot);
      } catch {
        // Dropped mid-load — the next reconnect reloads.
      }
    })();
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [status]);
}
