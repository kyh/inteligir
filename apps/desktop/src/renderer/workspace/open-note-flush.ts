// A module-level handle to flush the currently-open note to disk, registered by
// the live VaultProvider. Lets non-React callers — specifically the voice
// transcript path in agent-store, which runs outside the component tree — make
// sure the agent reads the latest bytes from `./vault` before a turn, the same
// way the composer flushes before a typed send.
//
// Mirrors the registered-callback seam used by the delegation notifier: the
// provider owns the implementation, this module is just the wire.

let flushImpl: (() => Promise<boolean>) | null = null;
let pathImpl: (() => string | null) | null = null;

// Upper bound on how long a flush may take before callers give up on it. A flush
// is a local disk write through IPC; if it somehow never settles, a serialized
// caller (the voice chain) must not wedge forever behind it.
const FLUSH_TIMEOUT_MS = 5000;

/** Wire (or clear, with null) the open-note flush. Called by VaultProvider. */
export function registerOpenNoteFlush(fn: (() => Promise<boolean>) | null): void {
  flushImpl = fn;
}

/** Wire (or clear, with null) a live getter for the open note's path. Called by
 * VaultProvider so non-React callers can tag a turn with the active note. */
export function registerOpenNotePath(fn: (() => string | null) | null): void {
  pathImpl = fn;
}

/** The path of the note currently open in the editor, or null. */
export function openNotePath(): string | null {
  return pathImpl ? pathImpl() : null;
}

/** Flush the open note. Resolves true when the buffer is clean afterward (or
 * there's no provider / nothing to flush). Never rejects, and always settles
 * within FLUSH_TIMEOUT_MS (resolving false on timeout) so a hung flush can't
 * deadlock a serialized caller. The timer is cleared once the race settles so it
 * never leaks. (JS can't cancel the underlying write; a flush slow enough to time
 * out — a >5s local disk write, i.e. a wedged main process — could still land
 * late, the documented last-write-wins residual. The timeout only bounds the
 * caller's wait, it doesn't abort the write.) */
export function flushOpenNote(): Promise<boolean> {
  if (!flushImpl) return Promise.resolve(true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), FLUSH_TIMEOUT_MS);
  });
  return Promise.race([flushImpl().catch(() => false), timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
