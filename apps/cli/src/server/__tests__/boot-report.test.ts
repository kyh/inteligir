import { describe, expect, it } from "vitest";
import { bootReport } from "../boot-report";

const phases = { claimMs: 3.4, composeMs: 410.2, indexMs: 2120.6, listenMs: 1.9 };

describe("the boot line", () => {
  it("names every phase's wall time and what the first reconcile found", () => {
    const line = bootReport(phases, {
      deferred: 1,
      listMs: 12.3,
      listed: 3,
      projected: 1,
      readMs: 2105,
      removed: 0,
      unchanged: 1,
    });
    expect(line).toBe(
      "[boot] 2536ms: claim 3ms, compose 410ms, listen 2ms, index 2121ms (listed 3 files in 12ms, read them in 2105ms: projected 1, unchanged 1, removed 0, deferred 1)",
    );
  });

  it("still names the phases when no reconcile finished", () => {
    expect(bootReport(phases, null)).toBe(
      "[boot] 2536ms: claim 3ms, compose 410ms, listen 2ms, index 2121ms (no reconcile finished)",
    );
  });
});
