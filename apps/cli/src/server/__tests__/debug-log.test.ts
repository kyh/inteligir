import { describe, expect, it, onTestFinished, vi } from "vitest";
import { debugLog } from "../debug-log";

describe("debugLog", () => {
  it("is absent for a namespace that is off, so a site's line is never built", () => {
    const log = debugLog(new Set(), "sync");
    expect(log).toBeUndefined();
    const build = vi.fn(() => "a line");
    log?.(build());
    expect(build).not.toHaveBeenCalled();
  });

  it("writes an on namespace's lines to stderr under its name", () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {
      /* empty */
    });
    onTestFinished(() => {
      stderr.mockRestore();
    });
    debugLog(new Set(["sync"]), "sync")?.("session 1 pull: caught-up");
    expect(stderr).toHaveBeenCalledWith("[debug:sync] session 1 pull: caught-up");
  });
});
