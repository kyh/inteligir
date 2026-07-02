import { describe, expect, it } from "vitest";

import {
  EMPTY_SESSION,
  activateTab,
  closeTab,
  cycleTab,
  moveTab,
  openTab,
  parseSession,
  renameTab,
  touchRecency,
  type TabSession,
} from "@repo/app/workspace/tab-session";

const session = (tabs: string[], active: string | null): TabSession => ({ tabs, active });

describe("openTab", () => {
  it("opens the first tab from empty", () => {
    expect(openTab(EMPTY_SESSION, "a.md", "replace")).toEqual(session(["a.md"], "a.md"));
    expect(openTab(EMPTY_SESSION, "a.md", "new")).toEqual(session(["a.md"], "a.md"));
  });

  it("replace swaps the path into the active slot", () => {
    const s = session(["a.md", "b.md", "c.md"], "b.md");
    expect(openTab(s, "x.md", "replace")).toEqual(session(["a.md", "x.md", "c.md"], "x.md"));
  });

  it("new inserts after the active tab", () => {
    const s = session(["a.md", "b.md", "c.md"], "a.md");
    expect(openTab(s, "x.md", "new")).toEqual(session(["a.md", "x.md", "b.md", "c.md"], "x.md"));
  });

  it("an already-open path just activates its tab — no duplicates", () => {
    const s = session(["a.md", "b.md"], "a.md");
    expect(openTab(s, "b.md", "replace")).toEqual(session(["a.md", "b.md"], "b.md"));
    expect(openTab(s, "b.md", "new")).toEqual(session(["a.md", "b.md"], "b.md"));
  });
});

describe("closeTab", () => {
  it("closing the active tab activates the right neighbor", () => {
    const s = session(["a.md", "b.md", "c.md"], "b.md");
    expect(closeTab(s, "b.md")).toEqual(session(["a.md", "c.md"], "c.md"));
  });

  it("closing the last (rightmost) active tab falls back left", () => {
    const s = session(["a.md", "b.md"], "b.md");
    expect(closeTab(s, "b.md")).toEqual(session(["a.md"], "a.md"));
  });

  it("closing a background tab keeps the active tab", () => {
    const s = session(["a.md", "b.md", "c.md"], "a.md");
    expect(closeTab(s, "c.md")).toEqual(session(["a.md", "b.md"], "a.md"));
  });

  it("closing the only tab empties the session", () => {
    expect(closeTab(session(["a.md"], "a.md"), "a.md")).toEqual(EMPTY_SESSION);
  });

  it("closing an unknown path is a no-op", () => {
    const s = session(["a.md"], "a.md");
    expect(closeTab(s, "x.md")).toBe(s);
  });
});

describe("activateTab / cycleTab", () => {
  it("activates a member tab and ignores strangers", () => {
    const s = session(["a.md", "b.md"], "a.md");
    expect(activateTab(s, "b.md").active).toBe("b.md");
    expect(activateTab(s, "x.md")).toBe(s);
  });

  it("cycles forward and backward with wrap-around", () => {
    const s = session(["a.md", "b.md", "c.md"], "c.md");
    expect(cycleTab(s, 1).active).toBe("a.md");
    expect(cycleTab(s, -1).active).toBe("b.md");
    expect(cycleTab(session(["a.md"], "a.md"), 1).active).toBe("a.md");
  });
});

describe("renameTab", () => {
  it("re-keys the tab in place, carrying active state", () => {
    const s = session(["a.md", "b.md"], "b.md");
    expect(renameTab(s, "b.md", "z.md")).toEqual(session(["a.md", "z.md"], "z.md"));
    expect(renameTab(s, "a.md", "z.md")).toEqual(session(["z.md", "b.md"], "b.md"));
  });

  it("collapses into an existing destination tab instead of duplicating", () => {
    const s = session(["a.md", "b.md"], "a.md");
    expect(renameTab(s, "a.md", "b.md")).toEqual(session(["b.md"], "b.md"));
  });

  it("collapsing a BACKGROUND tab into an open destination keeps the active tab", () => {
    const s = session(["a.md", "b.md", "c.md"], "c.md");
    expect(renameTab(s, "a.md", "b.md")).toEqual(session(["b.md", "c.md"], "c.md"));
  });

  it("ignores unknown sources", () => {
    const s = session(["a.md"], "a.md");
    expect(renameTab(s, "x.md", "y.md")).toBe(s);
  });
});

describe("moveTab", () => {
  it("moves a tab to a new index, keeping active by path", () => {
    const s = session(["a.md", "b.md", "c.md"], "a.md");
    expect(moveTab(s, 0, 2)).toEqual(session(["b.md", "c.md", "a.md"], "a.md"));
  });

  it("rejects out-of-range moves", () => {
    const s = session(["a.md", "b.md"], "a.md");
    expect(moveTab(s, 0, 5)).toBe(s);
    expect(moveTab(s, 5, 0)).toBe(s);
  });
});

describe("parseSession", () => {
  it("round-trips a valid session", () => {
    const s = session(["a.md", "b.md"], "b.md");
    expect(parseSession(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it("repairs a missing/foreign active to the first tab", () => {
    expect(parseSession({ tabs: ["a.md", "b.md"], active: "x.md" })).toEqual(
      session(["a.md", "b.md"], "a.md"),
    );
    expect(parseSession({ tabs: ["a.md"] })).toEqual(session(["a.md"], "a.md"));
    expect(parseSession({ active: 7, tabs: ["a.md", "b.md"] })).toEqual(
      session(["a.md", "b.md"], "a.md"),
    );
  });

  it("rejects malformed shapes and duplicates", () => {
    expect(parseSession(null)).toBeUndefined();
    expect(parseSession({ tabs: "a.md" })).toBeUndefined();
    expect(parseSession({ tabs: ["a.md", "a.md"] })).toBeUndefined();
    expect(parseSession({ tabs: [1] })).toBeUndefined();
    expect(parseSession({ tabs: [] })).toEqual(EMPTY_SESSION);
  });
});

describe("touchRecency (live-pane retention, #369)", () => {
  const tabs = ["a.md", "b.md", "c.md"];

  it("moves the active path to the front", () => {
    expect(touchRecency(["a.md", "b.md"], tabs, "b.md")).toEqual(["b.md", "a.md"]);
  });

  it("inserts a newly activated path", () => {
    expect(touchRecency(["a.md"], tabs, "c.md")).toEqual(["c.md", "a.md"]);
    expect(touchRecency([], tabs, "a.md")).toEqual(["a.md"]);
  });

  it("drops paths whose tabs closed", () => {
    expect(touchRecency(["a.md", "x.md", "b.md"], tabs, "a.md")).toEqual(["a.md", "b.md"]);
  });

  it("alternating between two tabs preserves the rest of the order", () => {
    let recency: readonly string[] = ["c.md", "b.md", "a.md"];
    recency = touchRecency(recency, tabs, "b.md");
    recency = touchRecency(recency, tabs, "c.md");
    recency = touchRecency(recency, tabs, "b.md");
    expect(recency).toEqual(["b.md", "c.md", "a.md"]);
  });

  it("is identity-stable on no-ops (render-adjust contract)", () => {
    const recency = ["b.md", "a.md"];
    expect(touchRecency(recency, tabs, "b.md")).toBe(recency);
    expect(touchRecency(recency, tabs, null)).toBe(recency);
    const empty: string[] = [];
    expect(touchRecency(empty, tabs, null)).toBe(empty);
  });
});
