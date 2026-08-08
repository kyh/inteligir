// ---------------------------------------------------------------------------
// The host's ONE alarm, and the multiplex over it.
//
// A Durable Object has exactly one pending alarm, so a second concern that
// calls `setAlarm` for itself silently cancels whatever was already armed. The
// multiplex is therefore structural rather than conventional: every concern
// runs its sweep when the object wakes, every concern answers when it next
// needs waking, and the alarm is re-armed at the earliest of them.
//
// Concerns are a LIST, so "when does this host wake?" is one place to read and
// adding a concern is one row rather than two edits that have to agree.
// `setAlarm` is confined to this class, which is what "no concern arms for
// itself" means; the count of call sites is a consequence, not the rule.
//
// A `setTimeout` is never the answer either — a pending timer PINS the object
// in memory, which is the hibernation the whole transport exists to get, and it
// dies with the eviction that a socket's auth deadline, a capture's ack and a
// routine's schedule all have to survive.
// ---------------------------------------------------------------------------

import { logUnhandledCallback } from "../log";

/** One deadline-keeping concern: what it does when the object wakes, and when
 * it next needs waking (`null` when it is owed nothing). */
export type AlarmConcern = {
  readonly sweep: (now: number) => void | Promise<void>;
  readonly dueAt: (now: number) => number | null;
};

/** The slice of `ctx.storage` this needs — the seam its own suite drives. */
export type AlarmStorage = {
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
};

export type HostAlarmDeps = {
  readonly storage: AlarmStorage;
  /** In sweep order. The alarm re-arms at the earliest `dueAt` afterwards. */
  readonly concerns: readonly AlarmConcern[];
  readonly now: () => number;
};

export class HostAlarm {
  /**
   * Set when something may have created or moved a deadline; consumed by
   * `refresh()` at the end of the inbound path.
   *
   * In memory, which is only safe because it is never read ACROSS an
   * invocation — and that in turn is only true because every inbound path
   * consumes it in a `finally`. Nothing anywhere re-derives it: a handler that
   * trashes a file and then throws is the whole reason the consumption cannot
   * sit on the success path, because the deadline it armed would never be.
   */
  private dirty = false;

  /** Set by `stop()`. An alarm outlives nothing; a purged account's storage is
   * gone, so arming against it is a throw with no caller who could act on it. */
  private stopped = false;

  private readonly deps: HostAlarmDeps;

  constructor(deps: HostAlarmDeps) {
    this.deps = deps;
  }

  /** A concern created or moved a deadline this host must wake for. */
  markDirty(): void {
    this.dirty = true;
  }

  /** The object woke: run every concern's sweep, then re-arm at the earliest
   * deadline any of them still holds. */
  async fire(): Promise<void> {
    if (this.stopped) return;
    for (const concern of this.deps.concerns) await concern.sweep(this.deps.now());
    // The sweeps just consumed whatever was pending; re-arming below is the
    // whole point of this method, so nothing is left for `refresh()` to do.
    this.dirty = false;
    const next = this.nextDueAt();
    if (next !== null) await this.deps.storage.setAlarm(next);
  }

  /**
   * Re-derive the alarm after an inbound path that moved a deadline. Skipped
   * entirely when none did, so a chatty read-only socket pays no storage read
   * per message.
   *
   * TOTAL, because it runs in a `finally`: an alarm this object could not arm
   * must not turn a served request into a 500 or a live socket into a closed
   * one, and there is nothing the caller could do about it either way.
   */
  async refresh(): Promise<void> {
    if (this.stopped || !this.dirty) return;
    this.dirty = false;
    try {
      const next = this.nextDueAt();
      if (next === null) return;
      // Never later than an alarm already due: an earlier deadline someone else
      // armed is the one that has to win.
      const existing = await this.deps.storage.getAlarm();
      if (existing === null || existing > next) await this.deps.storage.setAlarm(next);
    } catch (error) {
      logUnhandledCallback("user-host", "refreshAlarm", error);
    }
  }

  /** This account is gone. Every later `fire`/`refresh` is a no-op — the
   * storage those would reach no longer exists. */
  stop(): void {
    this.stopped = true;
  }

  /** When this host next needs waking: the earliest of every concern's own
   * next-due time, or `null` when nothing is pending. */
  private nextDueAt(): number | null {
    const now = this.deps.now();
    let earliest: number | null = null;
    for (const concern of this.deps.concerns) {
      const at = concern.dueAt(now);
      if (at !== null && (earliest === null || at < earliest)) earliest = at;
    }
    return earliest;
  }
}
