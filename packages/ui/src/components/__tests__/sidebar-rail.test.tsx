// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { Sidebar } from "../sidebar";
import { SidebarProvider } from "../sidebar-core";
import type { SidebarActions } from "../sidebar-core";

const mediaQueryList = (query: string, matches: boolean): MediaQueryList => ({
  addEventListener: () => {},
  addListener: () => {},
  dispatchEvent: () => false,
  matches,
  media: query,
  onchange: null,
  removeEventListener: () => {},
  removeListener: () => {},
});

/* oxlint-disable anti-slop/no-runtime-typeof -- feature detection over host objects: jsdom has
   neither media queries nor pointer capture, and the rail reads both. */
beforeAll(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (query: string) => mediaQueryList(query, false);
  }
  if (typeof Element.prototype.setPointerCapture !== "function") {
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  }
});
/* oxlint-enable anti-slop/no-runtime-typeof */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom lays nothing out, so the shell measures 0 wide and every drag starts from there
const mountSidebar = (props: {
  onOpenChange?: (open: boolean) => void;
  onWidthCommitted?: (px: number) => void;
}) => {
  render(
    <SidebarProvider open {...props}>
      <Sidebar>rows</Sidebar>
    </SidebarProvider>,
  );
  return screen.getByRole("button", { name: "Resize or collapse sidebar" });
};

describe("the rail's resize", () => {
  it("reports the width once, where the drag let go", () => {
    const onWidthCommitted = vi.fn<(px: number) => void>();
    const rail = mountSidebar({ onWidthCommitted });
    fireEvent.pointerDown(rail, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(rail, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(rail, { clientX: 300, pointerId: 1 });
    expect(onWidthCommitted).not.toHaveBeenCalled();
    fireEvent.pointerUp(rail, { clientX: 300, pointerId: 1 });
    expect(onWidthCommitted.mock.calls).toEqual([[300]]);
  });

  it("reports the narrowest width when the drag collapses the sidebar", () => {
    const onWidthCommitted = vi.fn<(px: number) => void>();
    const onOpenChange = vi.fn<(open: boolean) => void>();
    const rail = mountSidebar({ onOpenChange, onWidthCommitted });
    fireEvent.pointerDown(rail, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(rail, { clientX: 50, pointerId: 1 });
    expect(onWidthCommitted.mock.calls).toEqual([[192]]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("still reports the width a cancelled drag reached, once", () => {
    const onWidthCommitted = vi.fn<(px: number) => void>();
    const rail = mountSidebar({ onWidthCommitted });
    fireEvent.pointerDown(rail, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(rail, { clientX: 250, pointerId: 1 });
    fireEvent.pointerCancel(rail, { clientX: 250, pointerId: 1 });
    fireEvent.lostPointerCapture(rail, { pointerId: 1 });
    expect(onWidthCommitted.mock.calls).toEqual([[250]]);
  });

  it("reports nothing for a click, which toggles instead", () => {
    const onWidthCommitted = vi.fn<(px: number) => void>();
    const onOpenChange = vi.fn<(open: boolean) => void>();
    const rail = mountSidebar({ onOpenChange, onWidthCommitted });
    fireEvent.pointerDown(rail, { clientX: 0, pointerId: 1 });
    fireEvent.pointerUp(rail, { clientX: 0, pointerId: 1 });
    expect(onWidthCommitted).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

// testing-library's role queries do not read `inert`, so the attribute is what is asserted
const inertAncestor = (element: HTMLElement): Element | null => element.closest("[inert]");

const panel = (open: boolean, peek: "click" | "none" = "none") => (
  <SidebarProvider open={open} peek={peek}>
    <Sidebar side="right">
      <button type="button">Row action</button>
    </Sidebar>
  </SidebarProvider>
);

describe("the collapsed panel", () => {
  it("stays mounted but inert, so its controls leave the tab order", () => {
    const view = render(panel(false));
    expect(inertAncestor(screen.getByText("Row action"))).not.toBeNull();

    view.rerender(panel(true));
    expect(inertAncestor(screen.getByText("Row action"))).toBeNull();
  });

  it("leaves the peek strip reachable, since it is the way back in", () => {
    render(panel(false, "click"));
    expect(screen.queryByText("Row action")).toBeNull();
    expect(inertAncestor(screen.getByRole("button", { name: "Peek sidebar" }))).toBeNull();
  });
});

describe("the provider", () => {
  it("listens for no key: the app's own table owns the toggle", () => {
    const onOpenChange = vi.fn<(open: boolean) => void>();
    mountSidebar({ onOpenChange });
    fireEvent.keyDown(document.body, { key: "[" });
    fireEvent.keyDown(document.body, { key: "]" });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("hands its owner the toggle, which opens the sheet below the mobile breakpoint", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation((query) => mediaQueryList(query, true));
    const actions = createRef<SidebarActions>();
    const onOpenChange = vi.fn<(open: boolean) => void>();
    render(
      <SidebarProvider open={false} onOpenChange={onOpenChange} actionsRef={actions}>
        <Sidebar>rows</Sidebar>
      </SidebarProvider>,
    );
    expect(screen.queryByRole("dialog", { name: "Sidebar" })).toBeNull();
    act(() => {
      actions.current?.toggle();
    });
    expect(await screen.findByRole("dialog", { name: "Sidebar" })).toBeDefined();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
