// One-note-one-pane: the coordinator is the whole rule — an open landing on
// the other pane's note FOCUSES that pane instead of mounting a second runtime
// over the same file (two writers would fight through the CAS/diff3 loop) —
// and the focus it settles on is published as state, which is what lets the
// shell follow the panes without a callback into React.

import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import { describe, expect, it, vi } from "vitest";

import { createPaneCoordinator } from "../split-view";

function coordinatorWithPanes() {
  const coordinator = createPaneCoordinator();
  const primary = createOpenNoteStore();
  coordinator.registerStore("primary", primary);
  coordinator.registerStore("split", createOpenNoteStore());
  return { coordinator, primary, focus: () => coordinator.store.getState() };
}

describe("pane coordinator", () => {
  it("refuses a path the other pane holds, focusing that pane instead", () => {
    const { coordinator, focus } = coordinatorWithPanes();
    coordinator.reportOpenPath("split", "notes/a.md");
    expect(coordinator.requestOpen("primary", "notes/a.md")).toBe(false);
    expect(focus().pane).toBe("split");
    // The mirror: the split asking for the primary's note focuses primary.
    coordinator.reportOpenPath("primary", "notes/b.md");
    expect(coordinator.requestOpen("split", "notes/b.md")).toBe(false);
    expect(focus().pane).toBe("primary");
  });

  it("grants a fresh path and focuses the asking pane", () => {
    const { coordinator, focus } = coordinatorWithPanes();
    coordinator.reportOpenPath("primary", "notes/a.md");
    expect(coordinator.requestOpen("split", "notes/c.md")).toBe(true);
    expect(focus().pane).toBe("split");
  });

  it("does not deflect toward a pane with no live store", () => {
    const coordinator = createPaneCoordinator();
    coordinator.registerStore("primary", createOpenNoteStore());
    // No split store: even a matching path cannot focus a pane that is gone.
    coordinator.reportOpenPath("split", "notes/a.md");
    coordinator.registerStore("split", null);
    expect(coordinator.requestOpen("primary", "notes/a.md")).toBe(true);
    expect(coordinator.store.getState().pane).toBe("primary");
  });

  it("returns focus to the primary when the split closes", () => {
    const { coordinator, focus } = coordinatorWithPanes();
    coordinator.reportOpenPath("primary", "notes/a.md");
    coordinator.reportOpenPath("split", "notes/b.md");
    coordinator.focus("split");
    expect(focus().pane).toBe("split");
    coordinator.registerStore("split", null);
    expect(focus()).toEqual({ pane: "primary", path: "notes/a.md" });
  });

  it("returns focus to the primary when the split's note vanishes", () => {
    const { coordinator, focus } = coordinatorWithPanes();
    coordinator.reportOpenPath("primary", "notes/a.md");
    coordinator.reportOpenPath("split", "notes/b.md");
    coordinator.focus("split");
    coordinator.reportOpenPath("split", null);
    expect(focus()).toEqual({ pane: "primary", path: "notes/a.md" });
  });

  it("publishes the focused pane's path on every move", () => {
    const { coordinator, focus } = coordinatorWithPanes();
    const seen = vi.fn();
    const unsubscribe = coordinator.store.subscribe(() => {
      seen(coordinator.store.getState());
    });
    coordinator.reportOpenPath("primary", "notes/a.md");
    coordinator.reportOpenPath("split", "notes/b.md");
    coordinator.focus("split");
    expect(focus()).toEqual({ pane: "split", path: "notes/b.md" });
    coordinator.focus("primary");
    expect(focus()).toEqual({ pane: "primary", path: "notes/a.md" });
    expect(seen).toHaveBeenLastCalledWith({ pane: "primary", path: "notes/a.md" });
    unsubscribe();
  });

  it("reads the focused pane's live note state, and nothing before one registers", () => {
    const coordinator = createPaneCoordinator();
    expect(coordinator.focusedState()).toBe(null);

    const { coordinator: ready, primary } = coordinatorWithPanes();
    primary.publishOpenPath("notes/a.md");
    expect(ready.focusedState()?.openPath).toBe("notes/a.md");
  });
});
