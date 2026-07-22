// The correctness core of scheduled routines, tested like the sync guard:
// slot computation per cadence, once-per-slot, missed-slots-collapse-to-one,
// the createdAt floor, disabled, and local-time "HH:MM" semantics. All dates
// are built with the LOCAL-time Date constructor on purpose — the schedule
// language is wall-clock time.

import { describe, expect, it } from "vitest";

import { isRoutineDue, lastScheduledSlot, parseTimeOfDay } from "../routine-schedule";
import type { RoutineSchedule } from "../routines";

// 2026-07-21 is a Tuesday (getDay() === 2).
const TUE = { year: 2026, month: 6, day: 21 };
const local = (day: number, hours: number, minutes = 0) =>
  new Date(TUE.year, TUE.month, day, hours, minutes, 0, 0);

describe("parseTimeOfDay", () => {
  it("parses 24h HH:MM", () => {
    expect(parseTimeOfDay("00:00")).toEqual({ hours: 0, minutes: 0 });
    expect(parseTimeOfDay("09:05")).toEqual({ hours: 9, minutes: 5 });
    expect(parseTimeOfDay("23:59")).toEqual({ hours: 23, minutes: 59 });
  });

  it("rejects anything else (fail-safe: invalid → never due)", () => {
    for (const bad of ["24:00", "9:00", "09:60", "0900", "09:5", "", "aa:bb", "09:00 "]) {
      expect(parseTimeOfDay(bad)).toBeNull();
    }
  });
});

describe("lastScheduledSlot — daily", () => {
  const daily: RoutineSchedule = { cadence: "daily", timeOfDay: "09:00" };

  it("after today's time → today's slot", () => {
    expect(lastScheduledSlot(daily, local(21, 15, 30))).toEqual(local(21, 9));
  });

  it("exactly at the slot → that slot (<= boundary)", () => {
    expect(lastScheduledSlot(daily, local(21, 9, 0))).toEqual(local(21, 9));
  });

  it("before today's time → yesterday's slot", () => {
    expect(lastScheduledSlot(daily, local(21, 8, 59))).toEqual(local(20, 9));
  });

  it("rolls across a month boundary", () => {
    const firstOfMonth = new Date(2026, 6, 1, 5, 0, 0, 0);
    expect(lastScheduledSlot(daily, firstOfMonth)).toEqual(new Date(2026, 5, 30, 9, 0, 0, 0));
  });
});

describe("lastScheduledSlot — weekly", () => {
  // Monday (1) at 09:00; now is Tuesday the 21st.
  const weekly: RoutineSchedule = { cadence: "weekly", timeOfDay: "09:00", dayOfWeek: 1 };

  it("a different weekday → the most recent matching day", () => {
    expect(lastScheduledSlot(weekly, local(21, 15))).toEqual(local(20, 9)); // Mon the 20th
  });

  it("on the scheduled weekday after the time → today", () => {
    expect(lastScheduledSlot(weekly, local(20, 10))).toEqual(local(20, 9));
  });

  it("on the scheduled weekday before the time → the previous week", () => {
    expect(lastScheduledSlot(weekly, local(20, 8))).toEqual(local(13, 9));
  });

  it("walks back across a month boundary", () => {
    // Wed 2026-07-01, schedule Sunday (0) 09:00 → Sun 2026-06-28.
    const now = new Date(2026, 6, 1, 12, 0, 0, 0);
    const sunday: RoutineSchedule = { cadence: "weekly", timeOfDay: "09:00", dayOfWeek: 0 };
    expect(lastScheduledSlot(sunday, now)).toEqual(new Date(2026, 5, 28, 9, 0, 0, 0));
  });
});

describe("lastScheduledSlot — monthly", () => {
  const monthly: RoutineSchedule = { cadence: "monthly", timeOfDay: "09:00", dayOfMonth: 15 };

  it("after this month's day → this month", () => {
    expect(lastScheduledSlot(monthly, local(21, 12))).toEqual(local(15, 9));
  });

  it("before this month's day → the previous month", () => {
    expect(lastScheduledSlot(monthly, local(14, 12))).toEqual(new Date(2026, 5, 15, 9, 0, 0, 0));
  });

  it("January before the day → December of the previous year", () => {
    const now = new Date(2026, 0, 10, 12, 0, 0, 0);
    expect(lastScheduledSlot(monthly, now)).toEqual(new Date(2025, 11, 15, 9, 0, 0, 0));
  });

  it("day 28 resolves in February (the ≤28 cap is why the slot always exists)", () => {
    const feb: RoutineSchedule = { cadence: "monthly", timeOfDay: "09:00", dayOfMonth: 28 };
    const now = new Date(2026, 2, 1, 0, 30, 0, 0); // Mar 1, before nothing this month
    expect(lastScheduledSlot(feb, now)).toEqual(new Date(2026, 1, 28, 9, 0, 0, 0));
  });
});

describe("isRoutineDue", () => {
  const daily: RoutineSchedule = { cadence: "daily", timeOfDay: "09:00" };
  const routine = (over: Partial<Parameters<typeof isRoutineDue>[0]> = {}) => ({
    enabled: true,
    schedule: daily,
    createdAt: local(19, 12).getTime(),
    lastRunAt: null,
    ...over,
  });

  it("disabled → never due, even with a passed slot", () => {
    expect(isRoutineDue(routine({ enabled: false }), local(21, 10))).toBe(false);
  });

  it("never ran, created before the slot → due once the slot passes", () => {
    // Created the 20th at noon (after that day's 9am slot): the 21st's slot
    // is its first — not due at 8:59, due at 9:01.
    const r = routine({ createdAt: local(20, 12).getTime() });
    expect(isRoutineDue(r, local(21, 8, 59))).toBe(false); // slot not reached
    expect(isRoutineDue(r, local(21, 9, 1))).toBe(true);
  });

  it("a slot missed since creation (never ran) is a catch-up: due on launch", () => {
    // Created the 19th; the 20th's slot passed while the app was closed.
    expect(isRoutineDue(routine(), local(21, 8, 59))).toBe(true);
  });

  it("created AFTER today's slot → not due until tomorrow's (no run-on-create surprise)", () => {
    const r = routine({ createdAt: local(21, 15).getTime() }); // 3pm, slot was 9am
    expect(isRoutineDue(r, local(21, 16))).toBe(false);
    expect(isRoutineDue(r, local(22, 9, 1))).toBe(true);
  });

  it("ran this slot → not due again until the next one (once per slot)", () => {
    const r = routine({ lastRunAt: local(21, 9, 2).getTime() });
    expect(isRoutineDue(r, local(21, 23, 59))).toBe(false);
    expect(isRoutineDue(r, local(22, 9, 1))).toBe(true);
  });

  it("N missed slots (app closed for days) → due ONCE, and the run clears it", () => {
    // Last ran the 17th; the 18th–20th slots were all missed; now the 21st 10am.
    const r = routine({ lastRunAt: local(17, 9, 1).getTime() });
    const now = local(21, 10);
    expect(isRoutineDue(r, now)).toBe(true);
    // One catch-up run stamps lastRunAt = now → no longer due (not 3 more times).
    expect(isRoutineDue({ ...r, lastRunAt: now.getTime() }, local(21, 23, 59))).toBe(false);
    // The next real slot still fires.
    expect(isRoutineDue({ ...r, lastRunAt: now.getTime() }, local(22, 9, 1))).toBe(true);
  });

  it("a manual run BEFORE the slot doesn't eat the slot; AFTER it does", () => {
    const before = routine({ lastRunAt: local(21, 8).getTime() }); // ran manually 8am
    expect(isRoutineDue(before, local(21, 9, 1))).toBe(true); // 9am slot still fires
    const after = routine({ lastRunAt: local(21, 9, 30).getTime() });
    expect(isRoutineDue(after, local(21, 10))).toBe(false);
  });

  it("weekly + monthly go through the same rule", () => {
    const weekly: RoutineSchedule = { cadence: "weekly", timeOfDay: "07:30", dayOfWeek: 2 }; // Tue
    expect(isRoutineDue(routine({ schedule: weekly }), local(21, 7, 29))).toBe(false);
    expect(isRoutineDue(routine({ schedule: weekly }), local(21, 7, 31))).toBe(true);
    const monthly: RoutineSchedule = { cadence: "monthly", timeOfDay: "07:30", dayOfMonth: 21 };
    expect(isRoutineDue(routine({ schedule: monthly }), local(21, 7, 31))).toBe(true);
    expect(
      isRoutineDue(routine({ schedule: monthly, lastRunAt: local(21, 8).getTime() }), local(28, 8)),
    ).toBe(false); // next month's 21st is the next slot
  });

  it("an invalid timeOfDay is never due (fail-safe, not a crash)", () => {
    // timeOfDay's static type is string (the pattern is a runtime guard), so
    // this needs no assertion — exactly the hole the parser re-covers.
    const bad: RoutineSchedule = { cadence: "daily", timeOfDay: "25:99" };
    expect(isRoutineDue(routine({ schedule: bad }), local(21, 12))).toBe(false);
  });
});
