import { describe, expect, it } from "vitest";

import { familiesMoved } from "./replica-queries";

const change = (kinds: string[], reset = false) => ({
  ids: new Set<string>(),
  kinds: new Set(kinds),
  overlapped: new Set<string>(),
  reset,
});

describe("what a change of the replica moves", () => {
  it("moves the threads alone for an agent's turn, and the library for every other row", () => {
    expect(familiesMoved(change(["thread_event"]))).toEqual({ library: false, threads: true });
    expect(familiesMoved(change(["item", "annotation"]))).toEqual({
      library: true,
      threads: false,
    });
    expect(familiesMoved(change(["folder", "thread"]))).toEqual({ library: true, threads: true });
  });

  it("moves everything on a reset", () => {
    expect(familiesMoved(change([], true))).toEqual({ library: true, threads: true });
  });
});
