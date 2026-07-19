import { describe, expect, it } from "vitest";

import {
  groupTasks,
  parseDateTarget,
  scheduledDateForTask,
  type SchedulableTask,
} from "../knowledge/task-schedule";

const CONFIG = { dailyFolder: "journal", dailyFormat: "YYYY-MM-DD" };

describe("parseDateTarget", () => {
  it("accepts ISO regardless of the configured format", () => {
    expect(parseDateTarget("2026-07-20", "DD-MM-YYYY")).toBe("2026-07-20");
  });

  it("accepts the configured non-ISO format", () => {
    expect(parseDateTarget("20-07-2026", "DD-MM-YYYY")).toBe("2026-07-20");
    expect(parseDateTarget("Daily 07.20.2026", "Daily MM.DD.YYYY")).toBe("2026-07-20");
  });

  it("rejects impossible calendar dates", () => {
    expect(parseDateTarget("2026-13-40", "YYYY-MM-DD")).toBeNull();
    expect(parseDateTarget("2026-02-30", "YYYY-MM-DD")).toBeNull();
  });

  it("rejects non-date targets", () => {
    expect(parseDateTarget("meeting notes", "YYYY-MM-DD")).toBeNull();
    expect(parseDateTarget("2026-07", "YYYY-MM-DD")).toBeNull();
  });
});

describe("scheduledDateForTask", () => {
  it("takes the first date-reading wiki target", () => {
    expect(
      scheduledDateForTask(["someone", "2026-07-20", "2026-08-01"], "notes/x.md", CONFIG),
    ).toBe("2026-07-20");
  });

  it("an explicit date link beats daily-note inheritance", () => {
    expect(scheduledDateForTask(["2026-07-20"], "journal/2026-07-09.md", CONFIG)).toBe(
      "2026-07-20",
    );
  });

  it("inherits the note's own daily date when no target reads as one", () => {
    expect(scheduledDateForTask(["hub"], "journal/2026-07-09.md", CONFIG)).toBe("2026-07-09");
  });

  it("resolves a configured non-ISO format both as link target and as filename", () => {
    const config = { dailyFolder: "daily", dailyFormat: "DD-MM-YYYY" };
    expect(scheduledDateForTask(["09-07-2026"], "notes/x.md", config)).toBe("2026-07-09");
    expect(scheduledDateForTask([], "daily/09-07-2026.md", config)).toBe("2026-07-09");
  });

  it("handles blank-folder (vault-root) dailies via the cleanFolder rule", () => {
    expect(scheduledDateForTask([], "2026-07-09.md", { ...CONFIG, dailyFolder: "" })).toBe(
      "2026-07-09",
    );
    expect(scheduledDateForTask([], "2026-07-09.md", { ...CONFIG, dailyFolder: "//" })).toBe(
      "2026-07-09",
    );
    // A nested note never inherits from a root-daily config.
    expect(
      scheduledDateForTask([], "notes/2026-07-09.md", { ...CONFIG, dailyFolder: "" }),
    ).toBeNull();
  });

  it("returns null when nothing reads as a date", () => {
    expect(scheduledDateForTask(["hub", "ideas"], "notes/x.md", CONFIG)).toBeNull();
  });
});

const task = (
  over: Partial<SchedulableTask> & { path: string; ordinal: number },
): SchedulableTask => ({
  checked: false,
  wikiTargets: [],
  ...over,
});

describe("groupTasks", () => {
  const TODAY = "2026-07-15";

  it("buckets by the injected todayIso, checked always lands in completed", () => {
    const groups = groupTasks(
      [
        task({ path: "journal/2026-07-14.md", ordinal: 0 }), // overdue (inherited)
        task({ path: "notes/a.md", ordinal: 0, wikiTargets: ["2026-07-15"] }), // today
        task({ path: "notes/a.md", ordinal: 1, wikiTargets: ["2026-07-20"] }), // upcoming
        task({ path: "notes/a.md", ordinal: 2 }), // unscheduled
        task({ path: "journal/2026-07-30.md", ordinal: 0, checked: true }), // completed (despite future date)
      ],
      CONFIG,
      TODAY,
    );
    expect(groups.overdue.map((t) => [t.path, t.date])).toEqual([
      ["journal/2026-07-14.md", "2026-07-14"],
    ]);
    expect(groups.today.map((t) => t.date)).toEqual(["2026-07-15"]);
    expect(groups.upcoming.map((t) => t.date)).toEqual(["2026-07-20"]);
    expect(groups.unscheduled.map((t) => t.ordinal)).toEqual([2]);
    expect(groups.completed.map((t) => t.path)).toEqual(["journal/2026-07-30.md"]);
  });

  it("the overdue boundary is exclusive: today's date is not overdue", () => {
    const groups = groupTasks(
      [task({ path: "n.md", ordinal: 0, wikiTargets: [TODAY] })],
      CONFIG,
      TODAY,
    );
    expect(groups.overdue).toEqual([]);
    expect(groups.today).toHaveLength(1);
  });

  it("sorts scheduled buckets by date, then path, then ordinal", () => {
    const groups = groupTasks(
      [
        task({ path: "b.md", ordinal: 0, wikiTargets: ["2026-08-02"] }),
        task({ path: "a.md", ordinal: 1, wikiTargets: ["2026-08-01"] }),
        task({ path: "a.md", ordinal: 0, wikiTargets: ["2026-08-01"] }),
      ],
      CONFIG,
      TODAY,
    );
    expect(groups.upcoming.map((t) => [t.date, t.path, t.ordinal])).toEqual([
      ["2026-08-01", "a.md", 0],
      ["2026-08-01", "a.md", 1],
      ["2026-08-02", "b.md", 0],
    ]);
  });
});
