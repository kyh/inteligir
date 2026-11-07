// @vitest-environment jsdom

// a bulk verb says what landed: an item a chunk did not land is never counted done, and a run
// where nothing landed closes with no sentence.

import { createORPCErrorFromJson } from "@orpc/client";
import { toast } from "@repo/ui/components/sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runBulk } from "./bulk-actions";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a bulk verb", () => {
  it("counts only what each chunk landed", async () => {
    const success = vi.spyOn(toast, "success");
    await runBulk({
      chunk: 1,
      done: (count) => `Moved ${String(count)} to Reading`,
      items: ["a.md", "taken.md", "b.md"],
      run: async ([path]) => await Promise.resolve(path === "taken.md" ? 0 : 1),
      verb: "Moving",
    });
    expect(success).toHaveBeenCalledWith("Moved 2 to Reading", expect.anything());
  });

  it("says nothing of its own when none landed", async () => {
    const success = vi.spyOn(toast, "success");
    const dismiss = vi.spyOn(toast, "dismiss");
    await runBulk({
      chunk: 1,
      done: (count) => `Moved ${String(count)} to Reading`,
      items: ["taken.md"],
      run: async () => await Promise.resolve(0),
      verb: "Moving",
    });
    expect(success).not.toHaveBeenCalled();
    expect(dismiss).toHaveBeenCalledWith(expect.anything());
  });

  it("stops at a chunk that fails, says how far it got, and lets a refusal say its own sentence", async () => {
    const failed = vi.spyOn(toast, "error");
    const asked: (readonly string[])[] = [];
    const job = {
      chunk: 2,
      done: (count: number) => `Deleted ${String(count)}`,
      items: ["a", "b", "c", "d", "e"],
      verb: "Deleting",
    };
    const stopsAtTheSecond = (cause: Error) => async (chunk: readonly string[]) => {
      asked.push(chunk);
      if (asked.length === 2) {
        throw cause;
      }
      return await Promise.resolve(chunk.length);
    };

    await runBulk({ ...job, run: stopsAtTheSecond(new Error("the socket closed")) });
    expect(failed.mock.lastCall?.[0]).toBe("Stopped after 2 of 5. The library didn't answer.");
    expect(asked).toStrictEqual([
      ["a", "b"],
      ["c", "d"],
    ]);

    asked.length = 0;
    const refusal = createORPCErrorFromJson({
      code: "QUOTA",
      data: undefined,
      defined: true,
      message: "Your library is full.",
    });
    await runBulk({ ...job, run: stopsAtTheSecond(refusal) });
    expect(failed.mock.lastCall?.[0]).toBe("Stopped after 2 of 5. Your library is full.");
  });
});
