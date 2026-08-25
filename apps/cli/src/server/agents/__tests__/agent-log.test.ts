import { describe, expect, it } from "vitest";
import { boundedLogKey, createBoundedAgentLog } from "../agent-log";

describe("the bounded agent log", () => {
  it("collapses messages differing only in volatile ids onto one key", () => {
    const a = boundedLogKey("dropped item/webSearch for thread thr_8kfm2q9xwz: no renderer");
    const b = boundedLogKey("dropped item/webSearch for thread thr_p4vv2n76aa: no renderer");
    expect(a).toBe(b);
    expect(a).toContain("item/webSearch");
  });

  it("logs the first occurrence in full, then only every 100th with a count", () => {
    const lines: string[] = [];
    const log = createBoundedAgentLog((line) => lines.push(line));
    for (let i = 0; i < 250; i += 1) {
      log(`dropped provider event for thread thr_${String(i).padStart(6, "0")}xx: no renderer`);
    }
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("thr_000000xx");
    expect(lines[1]).toContain("seen 100x");
    expect(lines[2]).toContain("seen 200x");
    // A different message class logs its own first occurrence.
    log("codex: some stderr line");
    expect(lines).toHaveLength(4);
  });
});
