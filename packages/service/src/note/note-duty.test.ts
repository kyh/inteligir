import { describe, expect, it } from "vitest";

import { deadline, dutyColumns, dutyOf, RETRY_MS, stepDuty } from "./note-duty";
import type { Duty, DutyEvent } from "./note-duty";

const CLEAN: Duty = { kind: "clean" };

const after = (events: readonly DutyEvent[]): Duty => {
  let duty: Duty = CLEAN;
  for (const event of events) {
    duty = stepDuty(duty, event);
  }
  return duty;
};

const T = 1_000_000;

describe("what a note owes its cell", () => {
  it("owes nothing once its body is projected, so it arms nothing", () => {
    const duty = after([
      { at: T, kind: "appended" },
      { at: T + 1, kind: "projected", stillDirty: false },
    ]);
    expect(duty).toStrictEqual(CLEAN);
    expect(deadline(duty)).toBeNull();
    expect(dutyColumns(duty)).toStrictEqual({ dirtyAt: null, retryAt: null });
  });

  it("ignores a failed projection with nothing owed", () => {
    expect(after([{ at: T, kind: "projectFailed" }])).toStrictEqual(CLEAN);
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
    expect(projected).toStrictEqual({ kind: "due", since: T + 2000 });
    expect(deadline(projected)).toBe((backstop ?? 0) + 2000);
  });

  it("reads a stored retry back as it was kept, and as nothing owed once the cell holds the version", () => {
    const duty = after([
      { at: T, kind: "appended" },
      { at: T + 10, kind: "projectFailed" },
    ]);
    const columns = dutyColumns(duty);
    expect(columns).toStrictEqual({ dirtyAt: T, retryAt: T + 10 + RETRY_MS });
    expect(dutyOf({ ...columns, projected: 0, version: 1 })).toStrictEqual(duty);
    expect(dutyOf({ ...columns, projected: 1, version: 1 })).toStrictEqual(CLEAN);
  });
});
