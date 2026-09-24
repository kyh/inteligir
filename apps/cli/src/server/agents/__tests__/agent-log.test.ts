import { describe, expect, it } from "vitest";
import { boundedLogKey, createBoundedAgentLog } from "../agent-log";

const silent = (): void => {
  /* empty */
};

// letters, not digits: a digit run is scrubbed, so a numbered line would collapse onto one key.
const lettersOf = (value: number): string => {
  let rest = value;
  let spelled = "";
  do {
    spelled = String.fromCodePoint(97 + (rest % 26)) + spelled;
    rest = Math.floor(rest / 26);
  } while (rest > 0);
  return spelled;
};

describe("the bounded agent log", () => {
  it("collapses messages differing only in volatile ids onto one key", () => {
    const a = boundedLogKey("dropped item/webSearch for thread thr_8kfm2q9xwz: no renderer");
    const b = boundedLogKey("dropped item/webSearch for thread thr_p4vv2n76aa: no renderer");
    expect(a).toBe(b);
    expect(a).toContain("item/webSearch");
  });

  it("collapses messages differing only in a timestamp or a duration, and keeps a short number", () => {
    expect(boundedLogKey("reaped idle agent session after 600123ms")).toBe(
      boundedLogKey("reaped idle agent session after 812ms"),
    );
    expect(boundedLogKey("stalled at 2026-09-23T10:11:12.345Z")).toBe(
      boundedLogKey("stalled at 2026-09-24T01:02:03Z"),
    );
    expect(boundedLogKey("adapter exited (code 3)")).not.toBe(
      boundedLogKey("adapter exited (code 1)"),
    );
  });

  it("logs the first occurrence in full, then only every 100th with a count", () => {
    const lines: string[] = [];
    const log = createBoundedAgentLog((line) => {
      lines.push(line);
    });
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

  it("holds at most 512 keys however many distinct classes arrive", () => {
    const counts = new Map<string, number>();
    const log = createBoundedAgentLog(silent, counts);
    for (let i = 0; i < 10_000; i += 1) {
      log(`codex: unrecognised notification ${lettersOf(i)}`);
      expect(counts.size).toBeLessThanOrEqual(512);
    }
    expect(counts.size).toBe(512);
  });

  it("evicts the least recently seen class, not a busy one", () => {
    const lines: string[] = [];
    const log = createBoundedAgentLog((line) => {
      lines.push(line);
    });
    log("codex: busy");
    for (let i = 0; i < 1000; i += 1) {
      log(`codex: once ${lettersOf(i)}`);
      log("codex: busy");
    }
    expect(lines.filter((line) => line === "agent: codex: busy")).toHaveLength(1);
  });
});
