// @vitest-environment jsdom

// a bulk verb says what landed: an item a chunk did not land is never counted done, and a run
// where nothing landed says so.

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
      past: "moved",
      run: async ([path]) => await Promise.resolve(path === "taken.md" ? 0 : 1),
      verb: "Moving",
    });
    expect(success).toHaveBeenCalledWith("Moved 2 to Reading", expect.anything());
  });

  it("says so when none landed", async () => {
    const success = vi.spyOn(toast, "success");
    const failed = vi.spyOn(toast, "error");
    const job = {
      chunk: 5,
      done: (count: number) => `Moved ${String(count)} to Reading`,
      past: "moved",
      run: async () => await Promise.resolve(0),
      verb: "Moving",
    };
    await runBulk({ ...job, items: Array.from({ length: 12 }, (_, at) => String(at)) });
    expect(failed.mock.lastCall?.[0]).toBe("None of these 12 items could be moved.");
    await runBulk({ ...job, items: ["taken.md"] });
    expect(failed.mock.lastCall?.[0]).toBe("That item couldn't be moved.");
    expect(success).not.toHaveBeenCalled();
  });

  it("says nothing for a run with nothing in it", async () => {
    const said = [vi.spyOn(toast, "success"), vi.spyOn(toast, "error")];
    await runBulk({
      chunk: 1,
      done: (count) => `Moved ${String(count)} to Reading`,
      items: [],
      past: "moved",
      run: async () => await Promise.resolve(0),
      verb: "Moving",
    });
    for (const toastKind of said) {
      expect(toastKind).not.toHaveBeenCalled();
    }
  });

  it("words a failure that landed nothing as a failure, not as someone stopping it", async () => {
    const failed = vi.spyOn(toast, "error");
    const job = {
      chunk: 500,
      done: (count: number) => `Deleted ${String(count)} forever.`,
      past: "deleted",
      run: async () => await Promise.reject(new Error("the socket closed")),
      verb: "Deleting",
    };
    await runBulk({ ...job, items: Array.from({ length: 12 }, (_, at) => String(at)) });
    expect(failed.mock.lastCall?.[0]).toBe(
      "None of these 12 items could be deleted. The library didn't answer.",
    );
  });

  it("counts what landed when it stops, not what it tried", async () => {
    const failed = vi.spyOn(toast, "error");
    let asked = 0;
    await runBulk({
      chunk: 2,
      done: (count) => `Moved ${String(count)} to Reading`,
      items: ["a", "b", "c", "d", "e"],
      past: "moved",
      run: async () => {
        asked += 1;
        if (asked === 2) {
          throw new Error("the socket closed");
        }
        return await Promise.resolve(1);
      },
      verb: "Moving",
    });
    expect(failed.mock.lastCall?.[0]).toBe("Stopped after 1 of 5. The library didn't answer.");
  });

  it("stops at a chunk that fails, says how far it got, and lets a refusal say its own sentence", async () => {
    const failed = vi.spyOn(toast, "error");
    const asked: (readonly string[])[] = [];
    const job = {
      chunk: 2,
      done: (count: number) => `Deleted ${String(count)}`,
      items: ["a", "b", "c", "d", "e"],
      past: "deleted",
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

  it.each([
    ["landed", async () => await Promise.resolve(1), "Moved 2 to Reading"],
    [
      "landed nothing",
      async () => await Promise.resolve(0),
      "None of these 2 items could be moved.",
    ],
    [
      "failed",
      async () => await Promise.reject(new Error("the socket closed")),
      "None of these 2 items could be moved. The library didn't answer.",
    ],
  ])("offers no Stop on the toast of a run that %s", async (_case, run, sentence) => {
    await runBulk({
      chunk: 1,
      done: (count) => `Moved ${String(count)} to Reading`,
      items: ["a", "b"],
      past: "moved",
      run,
      verb: "Moving",
    });
    const closing = toast.getToasts().find((shown) => "title" in shown && shown.title === sentence);
    expect(closing).toBeDefined();
    expect(closing).not.toHaveProperty("action.label", "Stop");
  });
});
