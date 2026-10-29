import { beforeEach, describe, expect, it } from "vitest";

import { createOpenNoteStore, historyStep } from "@repo/editor/note/open-note-store";
import type { HistoryEntry } from "@repo/editor/note/open-note-store";

let store = createOpenNoteStore();
const publishOpenPath: (typeof store)["publishOpenPath"] = (path, change) => {
  store.publishOpenPath(path, change);
};

const backTarget = (): HistoryEntry | undefined => historyStep(store.state(), "back")?.to;
const forwardTarget = (): HistoryEntry | undefined => historyStep(store.state(), "forward")?.to;
const stepBack = (): void => {
  const step = historyStep(store.state(), "back");
  if (step !== null) {
    publishOpenPath(step.to);
  }
};
const stepForward = (): void => {
  const step = historyStep(store.state(), "forward");
  if (step !== null) {
    publishOpenPath(step.to);
  }
};

const stacks = () => {
  const state = store.state();
  return { back: state.back, forward: state.forward, open: state.openPath };
};

describe("open-note navigation history", () => {
  beforeEach(() => {
    store = createOpenNoteStore();
  });

  it("has nowhere to step before anything opens", () => {
    expect(historyStep(store.state(), "back")).toBeNull();
    expect(historyStep(store.state(), "forward")).toBeNull();
  });

  it("remembers the library the first open left, so Back returns to it", () => {
    publishOpenPath("a.md");
    expect(stacks()).toEqual({ back: [null], forward: [], open: "a.md" });
    expect(backTarget()).toBeNull();
    stepBack();
    expect(stacks()).toEqual({ back: [], forward: ["a.md"], open: null });
    expect(forwardTarget()).toBe("a.md");
  });

  it("pushes the item you left onto back", () => {
    publishOpenPath("a.md");
    publishOpenPath("b.md");
    publishOpenPath("c.md");
    expect(stacks().back).toEqual([null, "a.md", "b.md"]);
    expect(backTarget()).toBe("b.md");
  });

  it("recognizes a Back move by VALUE, so no caller has to flag it", () => {
    publishOpenPath("a.md");
    publishOpenPath("b.md");
    stepBack();
    expect(stacks()).toEqual({ back: [null], forward: ["b.md"], open: "a.md" });
    expect(forwardTarget()).toBe("b.md");
  });

  it("walks back and forward over the same trail, through the library", () => {
    publishOpenPath("a.md");
    publishOpenPath("b.md");
    publishOpenPath(null);
    publishOpenPath("c.md");
    expect(stacks()).toEqual({ back: [null, "a.md", "b.md", null], forward: [], open: "c.md" });
    stepBack();
    stepBack();
    expect(stacks()).toEqual({ back: [null, "a.md"], forward: ["c.md", null], open: "b.md" });
    stepForward();
    expect(stacks()).toEqual({ back: [null, "a.md", "b.md"], forward: ["c.md"], open: null });
    stepForward();
    expect(stacks()).toEqual({ back: [null, "a.md", "b.md", null], forward: [], open: "c.md" });
  });

  it("drops the forward trail when a fresh navigation branches off it", () => {
    publishOpenPath("a.md");
    publishOpenPath("b.md");
    stepBack();
    publishOpenPath("z.md");
    expect(stacks()).toEqual({ back: [null, "a.md"], forward: [], open: "z.md" });
  });

  it("leaves the stacks alone when the same path is republished", () => {
    publishOpenPath("a.md");
    publishOpenPath("b.md");
    publishOpenPath("b.md");
    expect(stacks().back).toEqual([null, "a.md"]);
  });

  it("rewrites a renamed item in place rather than remembering the path it left", () => {
    publishOpenPath("a.md");
    publishOpenPath("b.md");
    publishOpenPath("b-renamed.md", "carry");
    expect(stacks()).toEqual({ back: [null, "a.md"], forward: [], open: "b-renamed.md" });

    publishOpenPath("c.md");
    publishOpenPath("c-renamed.md", "carry");
    expect(stacks().back).toEqual([null, "a.md", "b-renamed.md"]);
  });

  it("remembers the item a close left, so Back reopens it", () => {
    publishOpenPath("a.md");
    publishOpenPath("b.md");
    publishOpenPath(null);
    expect(backTarget()).toBe("b.md");
    expect(store.state().editor).toEqual({ kind: "closed" });
  });

  it("takes a close back to the library it came from as that Back step, so Forward reopens it", () => {
    publishOpenPath("a.md");
    publishOpenPath(null);
    expect(stacks()).toEqual({ back: [], forward: ["a.md"], open: null });
    stepForward();
    expect(stacks()).toEqual({ back: [null], forward: [], open: "a.md" });
  });
});
