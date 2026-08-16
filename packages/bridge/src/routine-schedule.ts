// ---------------------------------------------------------------------------
// Pure routine schedule math — the correctness core of scheduled routines.
// Given a routine's schedule + when it last ran + the current instant, is it
// due? No I/O, no clock: callers pass `now` (the injected-clock pattern —
// @repo/notes/daily-path is the precedent). All math is LOCAL time: "09:00"
// means 9am on the user's wall clock, like the daily-note convention.
//
// The due rule is deliberately one comparison:
//     due ⇔ enabled ∧ lastScheduledSlot(now) > (lastRunAt ?? createdAt)
// which gives every required behavior for free:
//   - fires once per slot (running stamps lastRunAt past the slot);
//   - N missed slots while the app was closed → due ONCE on launch (only the
//     LATEST passed slot is compared);
//   - a freshly created routine never fires for a slot that passed before it
//     existed (createdAt is the floor);
//   - disabled → never.
// ---------------------------------------------------------------------------

import type { RoutineSchedule } from "./routines";

/** Parse "HH:MM" (24h). Null on anything else — fail-safe: an invalid time
 * makes a routine never due rather than due at a surprise moment. */
export function parseTimeOfDay(timeOfDay: string): { hours: number; minutes: number } | null {
  const match = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(timeOfDay);
  if (match === null) return null;
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

/** The most recent scheduled slot at or before `now`, in local time. Null
 * only when the timeOfDay string is invalid (fail-safe, see parseTimeOfDay) —
 * every valid schedule always has a slot within the last day/week/month.
 *
 * Built with the local-time Date constructor, so DST transitions resolve the
 * way the platform resolves them (a nonexistent 02:30 shifts forward; an
 * ambiguous one picks the platform's offset) — good enough for a notes
 * routine, and never a crash or a skipped month. */
export function lastScheduledSlot(schedule: RoutineSchedule, now: Date): Date | null {
  const time = parseTimeOfDay(schedule.timeOfDay);
  if (time === null) return null;
  const slotOn = (year: number, month: number, day: number): Date =>
    new Date(year, month, day, time.hours, time.minutes, 0, 0);

  switch (schedule.cadence) {
    case "daily": {
      const today = slotOn(now.getFullYear(), now.getMonth(), now.getDate());
      if (today.getTime() <= now.getTime()) return today;
      return slotOn(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    }
    case "weekly": {
      // Walk back day-by-day (≤ 7 steps) to the most recent matching weekday
      // whose slot time has passed. Day stepping goes through the Date
      // constructor's rollover, so month/year boundaries need no cases.
      for (let back = 0; back <= 7; back++) {
        const candidate = slotOn(now.getFullYear(), now.getMonth(), now.getDate() - back);
        if (candidate.getDay() === schedule.dayOfWeek && candidate.getTime() <= now.getTime()) {
          return candidate;
        }
      }
      return null; // unreachable for a valid schedule; fail-safe anyway
    }
    case "monthly": {
      // dayOfMonth ≤ 28, so the slot exists in every month.
      const thisMonth = slotOn(now.getFullYear(), now.getMonth(), schedule.dayOfMonth);
      if (thisMonth.getTime() <= now.getTime()) return thisMonth;
      return slotOn(now.getFullYear(), now.getMonth() - 1, schedule.dayOfMonth);
    }
  }
}

/** The FIRST scheduled slot strictly after `after`, in local time. Null only
 * when the timeOfDay string is invalid (fail-safe, see parseTimeOfDay).
 *
 * The mirror of `lastScheduledSlot`, and the reason it exists is a host that
 * SLEEPS between slots: a device that can be woken at an instant needs to know
 * which instant, where one polling on an interval only ever needs to know
 * whether a slot has passed. Same local-time construction, so the two answer
 * about the same calendar. */
export function nextScheduledSlot(schedule: RoutineSchedule, after: Date): Date | null {
  const time = parseTimeOfDay(schedule.timeOfDay);
  if (time === null) return null;
  const slotOn = (year: number, month: number, day: number): Date =>
    new Date(year, month, day, time.hours, time.minutes, 0, 0);

  switch (schedule.cadence) {
    case "daily": {
      const today = slotOn(after.getFullYear(), after.getMonth(), after.getDate());
      if (today.getTime() > after.getTime()) return today;
      return slotOn(after.getFullYear(), after.getMonth(), after.getDate() + 1);
    }
    case "weekly": {
      // Day stepping goes through the Date constructor's rollover, so month
      // and year boundaries need no cases.
      for (let ahead = 0; ahead <= 7; ahead++) {
        const candidate = slotOn(after.getFullYear(), after.getMonth(), after.getDate() + ahead);
        if (candidate.getDay() === schedule.dayOfWeek && candidate.getTime() > after.getTime()) {
          return candidate;
        }
      }
      return null; // unreachable for a valid schedule; fail-safe anyway
    }
    case "monthly": {
      // dayOfMonth ≤ 28, so the slot exists in every month.
      const thisMonth = slotOn(after.getFullYear(), after.getMonth(), schedule.dayOfMonth);
      if (thisMonth.getTime() > after.getTime()) return thisMonth;
      return slotOn(after.getFullYear(), after.getMonth() + 1, schedule.dayOfMonth);
    }
  }
}

/** The fields the due computation reads — a structural slice of Routine so
 * tests and the manager can pass exactly what matters. */
export type RoutineDueView = {
  enabled: boolean;
  schedule: RoutineSchedule;
  /** Creation instant (epoch ms) — the due floor. */
  createdAt: number;
  /** Last dispatch instant (epoch ms), or null if the routine never ran. */
  lastRunAt: number | null;
};

/** Is this routine due to run at `now`? See the module header for the rule
 * and the behaviors it encodes. */
export function isRoutineDue(routine: RoutineDueView, now: Date): boolean {
  if (!routine.enabled) return false;
  const slot = lastScheduledSlot(routine.schedule, now);
  if (slot === null) return false;
  const floor = routine.lastRunAt ?? routine.createdAt;
  return slot.getTime() > floor;
}

/**
 * The instant this routine BECOMES due — the first slot past its floor — or
 * null when it never will (disabled, or an unparseable time).
 *
 * The same rule as `isRoutineDue` read forwards instead of backwards:
 * `isRoutineDue(r, now)` holds exactly when this answer is at or before `now`.
 * Stated here rather than derived at each caller, so a host that arms a timer
 * from it and a host that polls the predicate can never disagree about when a
 * routine fires.
 */
export function nextRoutineDueAt(routine: RoutineDueView): Date | null {
  if (!routine.enabled) return null;
  return nextScheduledSlot(routine.schedule, new Date(routine.lastRunAt ?? routine.createdAt));
}
