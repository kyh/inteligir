// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { Sidebar } from "../sidebar";
import { SidebarProvider } from "../sidebar-core";

/* oxlint-disable anti-slop/no-runtime-typeof -- feature detection over host objects: jsdom has
   neither media queries nor pointer capture, and the rail reads both. */
beforeAll(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (query: string) => ({
      addEventListener: () => {},
      addListener: () => {},
      dispatchEvent: () => false,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: () => {},
      removeListener: () => {},
    });
  }
  if (typeof Element.prototype.setPointerCapture !== "function") {
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  }
});
/* oxlint-enable anti-slop/no-runtime-typeof */

afterEach(cleanup);

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

describe("the provider", () => {
  it("listens for no key: the app's own table owns the toggle", () => {
    const onOpenChange = vi.fn<(open: boolean) => void>();
    mountSidebar({ onOpenChange });
    fireEvent.keyDown(document.body, { key: "[" });
    fireEvent.keyDown(document.body, { key: "]" });
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
