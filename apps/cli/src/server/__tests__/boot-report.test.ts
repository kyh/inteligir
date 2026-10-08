import { describe, expect, it } from "vitest";
import { bootReport } from "../boot-report";

describe("the boot line", () => {
  it("names every phase's wall time and their sum", () => {
    expect(bootReport({ claimMs: 3.4, composeMs: 410.2, listenMs: 2.1 })).toBe(
      "[boot] 416ms: claim 3ms, compose 410ms, listen 2ms",
    );
  });
});
