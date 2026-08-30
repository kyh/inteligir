import { beforeEach, describe, expect, it } from "vitest";

import { backTarget, createOpenNoteStore, forwardTarget } from "@repo/editor/note/open-note-store";

// A fresh history machine per case — the store is a factory, not module state.
let store = createOpenNoteStore();
const publishOpenPath: (typeof store)["publishOpenPath"] = (path, change) =>
  store.publishOpenPath(path, change);

/** The back/forward stacks, as the buttons read them. */
function stacks() {
  const state = store.state();
  return { back: state.back, forward: state.forward, open: state.openPath };
}

describe("open-note navigation history", () => {
  beforeEach(() => {
    store = createOpenNoteStore();
  });

  it("records nothing for the first open — there is nowhere to go back to", () => {
    publishOpenPath("a.md");
    expect(stacks()).toEqual({ back: [], forward: [], open: "a.md" });
    expect(backTarget(store.state())).toBeNull();
  });

  it("pushes the note you left onto back", () => {
    publishOpenPath("a.md");
    publishOpenPath("b.md");
    publishOpenPath("c.md");
    expect(stacks().back).toEqual(["a.md", "b.md"]);
    expect(backTarget(store.state())).toBe("b.md");
  });

  it("recognizes a Back move by VALUE, so no caller has to flag it", () => {
    publishOpenPath("a.md");
    publishOpenPath("b.md");
    // What the Back button does: open the remembered path, nothing more.
    publishOpenPath(backTarget(store.state()));
    expect(stacks()).toEqual({ back: [], forward: ["b.md"], open: "a.md" });
    expect(forwardTarget(store.state())).toBe("b.md");
  });

  it("walks back and forward over the same trail", () => {
    publishOpenPath("a.md");
    publishOpenPath("b.md");
    publishOpenPath("c.md");
    publishOpenPath(backTarget(store.state()));
    publishOpenPath(backTarget(store.state()));
    expect(stacks()).toEqual({ back: [], forward: ["c.md", "b.md"], open: "a.md" });
    publishOpenPath(forwardTarget(store.state()));
    expect(stacks()).toEqual({ back: ["a.md"], forward: ["c.md"], open: "b.md" });
  });

  it("drops the forward trail when a fresh navigation branches off it", () => {
    publishOpenPath("a.md");
    publishOpenPath("b.md");
    publishOpenPath(backTarget(store.state()));
    publishOpenPath("z.md");
    expect(stacks()).toEqual({ back: ["a.md"], forward: [], open: "z.md" });
  });

  it("leaves the stacks alone when the same path is republished", () => {
    publishOpenPath("a.md");
    publishOpenPath("b.md");
    publishOpenPath("b.md");
    expect(stacks().back).toEqual(["a.md"]);
  });

  it("rewrites a renamed note in place rather than remembering the path it left", () => {
    publishOpenPath("a.md");
    publishOpenPath("b.md");
    publishOpenPath("b-renamed.md", "carry");
    // Back must not offer "b.md" — the rename deleted it.
    expect(stacks()).toEqual({ back: ["a.md"], forward: [], open: "b-renamed.md" });

    publishOpenPath("c.md");
    publishOpenPath("c-renamed.md", "carry");
    expect(stacks().back).toEqual(["a.md", "b-renamed.md"]);
  });

  it("remembers the note a close left, so Back reopens it", () => {
    publishOpenPath("a.md");
    publishOpenPath(null);
    expect(backTarget(store.state())).toBe("a.md");
  });
});
