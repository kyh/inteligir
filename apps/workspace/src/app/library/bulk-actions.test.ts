// @vitest-environment jsdom

// a bulk verb says what landed: an item a move or a tag refused is never counted done, and a run
// where nothing landed closes with no sentence of its own (the refusal already said why).

import { toast } from "@repo/ui/components/sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runBulk } from "./bulk-actions";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a bulk verb", () => {
  it("counts only what each chunk landed", async () => {
    const success = vi.spyOn(toast, "success");
    const outcome = await runBulk({
      chunk: 1,
      done: (count) => `Moved ${String(count)} to Reading`,
      items: ["a.md", "taken.md", "b.md"],
      run: async ([path]) => await Promise.resolve(path === "taken.md" ? 0 : 1),
      verb: "Moving",
    });
    expect(outcome).toEqual({ count: 2, kind: "done" });
    expect(success).toHaveBeenCalledWith("Moved 2 to Reading", expect.anything());
  });

  it("says nothing of its own when none landed", async () => {
    const success = vi.spyOn(toast, "success");
    const dismiss = vi.spyOn(toast, "dismiss");
    const outcome = await runBulk({
      chunk: 1,
      done: (count) => `Moved ${String(count)} to Reading`,
      items: ["taken.md"],
      run: async () => await Promise.resolve(0),
      verb: "Moving",
    });
    expect(outcome).toEqual({ count: 0, kind: "done" });
    expect(success).not.toHaveBeenCalled();
    expect(dismiss).toHaveBeenCalled();
  });
});
