// ---------------------------------------------------------------------------
// BackgroundTurnLock — the one-turn-at-a-time guarantee for the SHARED
// background pi session. Two managers dispatch onto that session — the
// DelegationManager (checkbox delegation) and the RoutinesManager (scheduled
// routines) — and each already serializes its OWN queue; this lock serializes
// them against EACH OTHER, so a routine can never interleave a delegation's
// turn (or vice versa) on the same session.
//
// Deliberately non-blocking (tryAcquire, not a waiter queue): both managers
// already have retry machinery for "agent busy", so contention just reuses it
// — no waiter ordering, no deadlock surface. Release is by token identity:
// a manager's stop() releases the token it holds (the background session is
// being torn down, so overlap with the abandoned in-flight run is the same
// accepted semantic delegation's runEpoch already encodes), and the abandoned
// run's own late release is a harmless no-op mismatch.
//
// The LIVE singletons share getBackgroundTurnLock(); the managers' constructor
// default is a private per-instance lock so existing unit tests stay hermetic
// (sharing is composition-root wiring, not a hidden global).
// ---------------------------------------------------------------------------

/** Opaque holder token. Object identity IS the lock ownership proof. */
export type BackgroundTurnToken = { readonly owner: "delegation" | "routine" };

export class BackgroundTurnLock {
  private current: BackgroundTurnToken | null = null;

  /** Take the lock, or null if another turn holds it (retry later). */
  tryAcquire(owner: BackgroundTurnToken["owner"]): BackgroundTurnToken | null {
    if (this.current !== null) return null;
    const token: BackgroundTurnToken = { owner };
    this.current = token;
    return token;
  }

  /** Release `token` if it is the current holder; a stale token (already
   * force-released by its manager's stop()) is a no-op. */
  release(token: BackgroundTurnToken): void {
    if (this.current === token) this.current = null;
  }

  /** Who holds the lock right now (for diagnostics/tests). */
  holder(): BackgroundTurnToken["owner"] | null {
    return this.current?.owner ?? null;
  }
}

// One lock per process — the background session is a process singleton too.
let instance: BackgroundTurnLock | null = null;

export function getBackgroundTurnLock(): BackgroundTurnLock {
  if (!instance) instance = new BackgroundTurnLock();
  return instance;
}
