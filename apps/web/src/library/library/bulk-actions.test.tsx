import { createORPCErrorFromJson } from "@orpc/client";
import { toast } from "@repo/ui/components/sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runBulk } from "./bulk-actions";

afterEach(() => {
  vi.restoreAllMocks();
});

const closing = (sentence: string) =>
  toast.getToasts().find((shown) => "title" in shown && shown.title === sentence);

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

  it("names what it runs over when that is no item", async () => {
    const failed = vi.spyOn(toast, "error");

    const job = {
      chunk: 1,
      done: (count: number) => `Saved ${String(count)}`,
      noun: "link",
      past: "saved",
      run: async () => await Promise.resolve(0),
      verb: "Saving",
    };

    await runBulk({ ...job, items: ["https://example.com"] });
    expect(failed.mock.lastCall?.[0]).toBe("That link couldn't be saved.");
    await runBulk({ ...job, items: ["https://example.com", "https://example.org"] });
    expect(failed.mock.lastCall?.[0]).toBe("None of these 2 links could be saved.");
  });

  it("shows a call that takes a while from the first, with nothing after it to stop", async () => {
    const running = vi.spyOn(toast, "loading");
    await runBulk({
      chunk: 1,
      done: (count) => `Added ${String(count)}`,
      items: ["photo.png"],
      past: "added",
      run: async () => await Promise.resolve(1),
      show: "always",
      verb: "Adding",
    });
    expect(running.mock.calls).toMatchObject([["Adding 1 of 1…", { action: undefined }]]);
  });

  it("offers Stop only while a call after the one in flight is left, and counts through it", async () => {
    const running = vi.spyOn(toast, "loading");
    await runBulk({
      chunk: 2,
      done: (count) => `Moved ${String(count)} to Reading`,
      items: ["a", "b", "c"],
      past: "moved",
      run: async (chunk) => await Promise.resolve(chunk.length),
      verb: "Moving",
    });
    expect(running.mock.calls).toMatchObject([
      ["Moving 2 of 3…", { action: { label: "Stop" } }],
      ["Moving 3 of 3…", { action: undefined }],
    ]);
  });

  it("puts the job's button on a closing toast where any landed, stopped or not", async () => {
    const undo = { label: "Undo", onClick: vi.fn<() => void>() };

    const job = {
      action: () => undo,
      chunk: 1,
      done: (count: number) => `Put ${String(count)} in Deleted`,
      items: ["a", "b"],
      past: "put in Deleted",
      verb: "Deleting",
    };

    let asked = 0;

    const secondFails = async () => {
      asked += 1;

      return asked === 2 ? await Promise.reject(new Error("the socket closed")) : 1;
    };

    await runBulk({ ...job, run: async () => await Promise.resolve(1) });
    await runBulk({ ...job, run: secondFails });
    await runBulk({
      ...job,
      run: async () => await Promise.reject(new Error("the socket closed")),
    });

    expect(closing("Put 2 in Deleted")).toHaveProperty("action", undo);
    expect(closing("Stopped after 1 of 2. The library didn't answer.")).toHaveProperty(
      "action",
      undo,
    );
    expect(
      closing("None of these 2 items could be put in Deleted. The library didn't answer."),
    ).toHaveProperty("action");
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
    expect(closing(sentence)).toBeDefined();
    expect(closing(sentence)).not.toHaveProperty("action.label", "Stop");
  });
});
