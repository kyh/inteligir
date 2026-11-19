import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { Sidebar } from "./sidebar";
import { SidebarProvider } from "./sidebar-core";
import type { SidebarActions } from "./sidebar-core";

const mediaQueryList = (query: string, matches: boolean) =>
  ({
    addEventListener: () => {},
    // oxlint-disable-next-line typescript/no-deprecated -- MediaQueryList still names it, so a stub that is one must define it
    addListener: () => {},
    dispatchEvent: () => false,
    matches,
    media: query,
    onchange: null,
    removeEventListener: () => {},
    // oxlint-disable-next-line typescript/no-deprecated -- MediaQueryList still names it, so a stub that is one must define it
    removeListener: () => {},
  }) satisfies MediaQueryList;

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
  vi.restoreAllMocks();
});

const mountSidebar = (props: {
  onOpenChange?: (open: boolean) => void;
  onWidthCommitted?: (px: number) => void;
}) => {
  render(
    <SidebarProvider open {...props}>
      <Sidebar label="Sidebar">rows</Sidebar>
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
    expect(onWidthCommitted.mock.calls).toStrictEqual([[300]]);
  });

  it("reports the narrowest width when the drag collapses the sidebar", () => {
    const onWidthCommitted = vi.fn<(px: number) => void>();
    const onOpenChange = vi.fn<(open: boolean) => void>();
    const rail = mountSidebar({ onOpenChange, onWidthCommitted });
    fireEvent.pointerDown(rail, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(rail, { clientX: 50, pointerId: 1 });
    expect(onWidthCommitted.mock.calls).toStrictEqual([[192]]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("still reports the width a cancelled drag reached, once", () => {
    const onWidthCommitted = vi.fn<(px: number) => void>();
    const rail = mountSidebar({ onWidthCommitted });
    fireEvent.pointerDown(rail, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(rail, { clientX: 250, pointerId: 1 });
    fireEvent.pointerCancel(rail, { clientX: 250, pointerId: 1 });
    fireEvent.lostPointerCapture(rail, { pointerId: 1 });
    expect(onWidthCommitted.mock.calls).toStrictEqual([[250]]);
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

const inertAncestor = (element: HTMLElement) => element.closest("[inert]");

const panel = (open: boolean) => (
  <SidebarProvider open={open}>
    <Sidebar side="right" label="Panel">
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
        <Sidebar label="Sidebar">rows</Sidebar>
      </SidebarProvider>,
    );
    expect(screen.queryByRole("dialog", { name: "Sidebar" })).toBeNull();
    act(() => {
      actions.current?.toggle();
    });
    const sheet = await screen.findByRole("dialog", { name: "Sidebar" });
    const title = within(sheet).getByRole("heading", { level: 2, name: "Sidebar" });
    expect(sheet.getAttribute("aria-labelledby")).toBe(title.id);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("hands its owner an open, which opens the sheet below the breakpoint and stays open asked twice", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation((query) => mediaQueryList(query, true));
    const actions = createRef<SidebarActions>();
    const onOpenChange = vi.fn<(open: boolean) => void>();
    render(
      <SidebarProvider open={false} onOpenChange={onOpenChange} actionsRef={actions}>
        <Sidebar label="Panel">rows</Sidebar>
      </SidebarProvider>,
    );
    act(() => {
      actions.current?.open();
      actions.current?.open();
    });
    await expect(screen.findByRole("dialog", { name: "Panel" })).resolves.toBeDefined();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("asks its owner to open above the breakpoint, where the owner holds the open", () => {
    const actions = createRef<SidebarActions>();
    const onOpenChange = vi.fn<(open: boolean) => void>();
    render(
      <SidebarProvider open={false} onOpenChange={onOpenChange} actionsRef={actions}>
        <Sidebar label="Panel">rows</Sidebar>
      </SidebarProvider>,
    );
    act(() => {
      actions.current?.open();
    });
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(true);
  });
});
