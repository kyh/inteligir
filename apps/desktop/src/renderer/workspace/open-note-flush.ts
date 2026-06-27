// A module-level handle to flush the currently-open note to disk, registered by
// the live VaultProvider. Lets non-React callers — specifically the voice
// transcript path in agent-store, which runs outside the component tree — make
// sure the agent reads the latest bytes from `./vault` before a turn, the same
// way the composer flushes before a typed send.
//
// Mirrors the registered-callback seam used by the delegation notifier: the
// provider owns the implementation, this module is just the wire.

let flushImpl: (() => Promise<boolean>) | null = null;

/** Wire (or clear, with null) the open-note flush. Called by VaultProvider. */
export function registerOpenNoteFlush(fn: (() => Promise<boolean>) | null): void {
  flushImpl = fn;
}

/** Flush the open note. Resolves true when the buffer is clean afterward (or
 * there's no provider / nothing to flush). Never rejects. */
export function flushOpenNote(): Promise<boolean> {
  if (!flushImpl) return Promise.resolve(true);
  return flushImpl().catch(() => false);
}
