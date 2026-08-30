// One-note-one-pane: the coordinator is the whole rule — an open landing on
// the other pane's note FOCUSES that pane instead of mounting a second runtime
// over the same file (two writers would fight through the CAS/diff3 loop) —
// and the focus it settles on is published as state, which is what lets the
// shell follow the panes without a callback into React.

import { createOpenNoteStore, type OpenNoteStore } from "@repo/editor/note/open-note-store";
import { describe, expect, it, vi } from "vitest";

import { createPaneCoordinator, type PaneCoordinator } from "../split-view";

function coordinatorWithPanes() {
  const coordinator = createPaneCoordinator();
  const primary = createOpenNoteStore();
  const split = createOpenNoteStore();
  coordinator.registerStore("primary", primary);
  coordinator.registerStore("split", split);
  return { coordinator, primary, split, focus: () => coordinator.store.getState() };
}

/** What a pane does on every open: ask, then publish to its own store, then
 *  report — the order the top bar's targets depend on. */
function open(coordinator: PaneCoordinator, pane: "primary" | "split", store: OpenNoteStore) {
  return (path: string | null): void => {
    if (path !== null && !coordinator.requestOpen(pane, path)) return;
    store.publishOpenPath(path);
    coordinator.reportOpenPath(pane, path);
  };
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

  it("grants an open into a pane that has not mounted yet, and focuses it", () => {
    const coordinator = createPaneCoordinator();
    coordinator.registerStore("primary", createOpenNoteStore());
    coordinator.reportOpenPath("primary", "notes/a.md");
    // "Open in split" asks before the second pane exists; the grant has to
    // move focus, or the top bar, the arrows, the comment badge and the
    // composer all keep naming the primary's note. The pane fills the path in
    // when it boots.
    expect(coordinator.requestOpen("split", "notes/b.md")).toBe(true);
    expect(coordinator.store.getState()).toEqual({
      pane: "split",
      path: null,
      back: null,
      forward: null,
    });
  });

  it("refuses a boot into the note the other pane has announced", () => {
    const { coordinator, focus } = coordinatorWithPanes();
    // The primary announces its deep link before it has the bytes, so the
    // split's own boot has something to be refused against.
    coordinator.reportOpenPath("primary", "notes/a.md");
    expect(coordinator.requestOpen("split", "notes/a.md")).toBe(false);
    expect(focus()).toEqual({ pane: "primary", path: "notes/a.md", back: null, forward: null });
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
    expect(focus()).toEqual({ pane: "primary", path: "notes/a.md", back: null, forward: null });
  });

  it("returns focus to the primary when the split's note vanishes", () => {
    const { coordinator, focus } = coordinatorWithPanes();
    coordinator.reportOpenPath("primary", "notes/a.md");
    coordinator.reportOpenPath("split", "notes/b.md");
    coordinator.focus("split");
    coordinator.reportOpenPath("split", null);
    expect(focus()).toEqual({ pane: "primary", path: "notes/a.md", back: null, forward: null });
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
    expect(focus()).toEqual({ pane: "split", path: "notes/b.md", back: null, forward: null });
    coordinator.focus("primary");
    expect(focus()).toEqual({ pane: "primary", path: "notes/a.md", back: null, forward: null });
    expect(seen).toHaveBeenLastCalledWith({
      pane: "primary",
      path: "notes/a.md",
      back: null,
      forward: null,
    });
    unsubscribe();
  });

  it("publishes the FOCUSED pane's back and forward targets", () => {
    const { coordinator, primary, split, focus } = coordinatorWithPanes();
    const openPrimary = open(coordinator, "primary", primary);
    const openSplit = open(coordinator, "split", split);

    openPrimary("notes/a.md");
    openPrimary("notes/b.md");
    openSplit("notes/x.md");
    openSplit("notes/y.md");
    expect(focus()).toEqual({
      pane: "split",
      path: "notes/y.md",
      back: "notes/x.md",
      forward: null,
    });

    // The arrows must describe the note the top bar is naming, not a pane the
    // user left behind.
    coordinator.focus("primary");
    expect(focus().back).toBe("notes/a.md");
    coordinator.focus("split");
    expect(focus().back).toBe("notes/x.md");
  });

  it("follows a Back move the pane recognized by value", () => {
    const { coordinator, split, focus } = coordinatorWithPanes();
    const openSplit = open(coordinator, "split", split);

    openSplit("notes/x.md");
    openSplit("notes/y.md");
    openSplit(focus().back);
    expect(focus()).toEqual({
      pane: "split",
      path: "notes/x.md",
      back: null,
      forward: "notes/y.md",
    });
  });

  it("reads the focused pane's live note state, and nothing before one registers", () => {
    const coordinator = createPaneCoordinator();
    expect(coordinator.focusedState()).toBe(null);

    const { coordinator: ready, primary } = coordinatorWithPanes();
    primary.publishOpenPath("notes/a.md");
    expect(ready.focusedState()?.openPath).toBe("notes/a.md");
  });
});
