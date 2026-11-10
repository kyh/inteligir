import { describe, expect, it } from "vitest";

import { deadline, dutyColumns, dutyOf, RETRY_MS, stepDuty } from "./note-duty";
import type { Duty, DutyEvent } from "./note-duty";

const SETTLED: Duty = { projection: { kind: "clean" }, seed: { kind: "none" } };

const after = (events: readonly DutyEvent[]): Duty => {
  let duty = SETTLED;
  for (const event of events) {
    duty = stepDuty(duty, event);
  }
  return duty;
};

const T = 1_000_000;

describe("what a note owes its cell", () => {
  it("keeps the seed's retry when a projection lands after its confirm failed", () => {
    const duty = after([
      { at: T, kind: "seeded" },
      { at: T, kind: "seedFailed" },
      { at: T + 1, kind: "projected", stillDirty: false },
    ]);
    expect(duty.seed).toStrictEqual({ at: T + RETRY_MS, kind: "retry" });
    expect(deadline(duty)).toBe(T + RETRY_MS);
  });

  it("owes nothing once a retried confirm lands and the body is projected, so it arms nothing", () => {
    const duty = after([
      { at: T, kind: "seeded" },
      { at: T, kind: "seedFailed" },
      { at: T + 1, kind: "projected", stillDirty: false },
      { kind: "seedConfirmed" },
    ]);
    expect(duty).toStrictEqual(SETTLED);
    expect(deadline(duty)).toBeNull();
    expect(dutyColumns(duty)).toStrictEqual({ dirtyAt: null, retryAt: null, seedPending: 0 });
  });

  it("ignores a confirm or a failed confirm with no seed pending, and a failed projection with nothing owed", () => {
    expect(after([{ kind: "seedConfirmed" }])).toStrictEqual(SETTLED);
    expect(after([{ at: T, kind: "seedFailed" }])).toStrictEqual(SETTLED);
    expect(after([{ at: T, kind: "projectFailed" }])).toStrictEqual(SETTLED);
  });

  it("waits for a failed projection's retry rather than a backstop already past", () => {
    const duty = after([
      { at: T, kind: "appended" },
      { at: T + 60_000, kind: "projectFailed" },
    ]);
    expect(deadline(duty)).toBe(T + 60_000 + RETRY_MS);
  });

  it("counts an edit's backstop from its first update, and one landed during a projection from that projection", () => {
    const edited = after([
      { at: T, kind: "appended" },
      { at: T + 500, kind: "appended" },
    ]);
    const backstop = deadline(edited);
    expect(backstop).not.toBeNull();
    const projected = stepDuty(edited, { at: T + 2000, kind: "projected", stillDirty: true });
    expect(projected.projection).toStrictEqual({ kind: "due", since: T + 2000 });
    expect(deadline(projected)).toBe((backstop ?? 0) + 2000);
  });

  it("reads one stored retry back as every owed duty's, the earlier of the two", () => {
    const duty = after([
      { at: T, kind: "seeded" },
      { at: T + 10, kind: "projectFailed" },
      { at: T, kind: "seedFailed" },
    ]);
    const columns = dutyColumns(duty);
    expect(columns).toStrictEqual({ dirtyAt: T, retryAt: T + RETRY_MS, seedPending: 1 });
    const read = dutyOf({ ...columns, projected: 0, version: 1 });
    expect(read).toStrictEqual({
      projection: { at: T + RETRY_MS, kind: "retry", since: T },
      seed: { at: T + RETRY_MS, kind: "retry" },
    });
    expect(deadline(read)).toBe(deadline(duty));
    expect(dutyOf({ ...columns, projected: 1, version: 1 }).projection).toStrictEqual({
      kind: "clean",
    });
  });
});
