// One-note-one-pane (#595): the coordinator is the whole rule — an open
// landing on the other pane's note FOCUSES that pane instead of mounting a
// second runtime over the same file (two writers would fight through the
// CAS/diff3 loop).

import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import { describe, expect, it, vi } from "vitest";

import { createPaneCoordinator } from "../split-view";

function coordinatorWithPanes() {
  const onFocusChange = vi.fn();
  const coordinator = createPaneCoordinator(onFocusChange);
  coordinator.registerStore("primary", createOpenNoteStore());
  coordinator.registerStore("split", createOpenNoteStore());
  return { coordinator, onFocusChange };
}

describe("pane coordinator", () => {
  it("refuses a path the other pane holds, focusing that pane instead", () => {
    const { coordinator } = coordinatorWithPanes();
    coordinator.reportOpenPath("split", "notes/a.md");
    expect(coordinator.requestOpen("primary", "notes/a.md")).toBe(false);
    expect(coordinator.focusedPane()).toBe("split");
    // The mirror: the split asking for the primary's note focuses primary.
    coordinator.reportOpenPath("primary", "notes/b.md");
    expect(coordinator.requestOpen("split", "notes/b.md")).toBe(false);
    expect(coordinator.focusedPane()).toBe("primary");
  });

  it("grants a fresh path and focuses the asking pane", () => {
    const { coordinator } = coordinatorWithPanes();
    coordinator.reportOpenPath("primary", "notes/a.md");
    expect(coordinator.requestOpen("split", "notes/c.md")).toBe(true);
    expect(coordinator.focusedPane()).toBe("split");
  });

  it("does not deflect toward a pane with no live store", () => {
    const onFocusChange = vi.fn();
    const coordinator = createPaneCoordinator(onFocusChange);
    coordinator.registerStore("primary", createOpenNoteStore());
    // No split store: even a matching path cannot focus a pane that is gone.
    coordinator.reportOpenPath("split", "notes/a.md");
    coordinator.registerStore("split", null);
    expect(coordinator.requestOpen("primary", "notes/a.md")).toBe(true);
    expect(coordinator.focusedPane()).toBe("primary");
  });

  it("returns focus to the primary when the split closes", () => {
    const { coordinator, onFocusChange } = coordinatorWithPanes();
    coordinator.reportOpenPath("split", "notes/a.md");
    coordinator.focus("split");
    expect(coordinator.focusedPane()).toBe("split");
    coordinator.registerStore("split", null);
    expect(coordinator.focusedPane()).toBe("primary");
    // The mirror callback saw the hand-back with the primary's path.
    const last = onFocusChange.mock.calls.at(-1);
    expect(last?.[0]).toBe("primary");
  });

  it("mirrors the focused pane's path on every move", () => {
    const { coordinator, onFocusChange } = coordinatorWithPanes();
    coordinator.reportOpenPath("primary", "notes/a.md");
    coordinator.reportOpenPath("split", "notes/b.md");
    coordinator.focus("split");
    expect(onFocusChange.mock.calls.at(-1)).toEqual(["split", "notes/b.md"]);
    coordinator.focus("primary");
    expect(onFocusChange.mock.calls.at(-1)).toEqual(["primary", "notes/a.md"]);
  });
});
