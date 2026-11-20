import { setImmediate as nextTask } from "node:timers/promises";

import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { scheduleBackground } from "./background";

describe("work run after a response", () => {
  it("logs a failed query's statement and never its parameters", async () => {
    const logged = vi.spyOn(console, "error");

    try {
      scheduleBackground(async () => {
        await Promise.resolve();
        throw new DrizzleQueryError(
          "insert into item_body values ($1)",
          ["the note's words"],
          new Error("boom"),
        );
      }, "jobs");
      await nextTask();

      expect(logged.mock.calls[0]?.[0]).toMatchObject({
        event: "background-failed",
        label: "jobs",
        message: "Failed query: insert into item_body values ($1)",
      });
      expect(JSON.stringify(logged.mock.calls)).not.toContain("the note's words");
    } finally {
      logged.mockRestore();
    }
  });
});
