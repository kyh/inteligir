// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { SidebarGroup, SidebarGroupLabel } from "../sidebar-core";

beforeAll(() => {
  if (!globalThis.ResizeObserver) {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    globalThis.ResizeObserver = ResizeObserverStub;
  }
});

afterEach(cleanup);

function group(open: boolean) {
  return (
    <SidebarGroup collapsible open={open}>
      <SidebarGroupLabel>Notes</SidebarGroupLabel>
      <button type="button">row</button>
    </SidebarGroup>
  );
}

describe("SidebarGroup", () => {
  it("makes a collapsed group's content inert, so its rows leave the tab order with the accessibility tree", () => {
    const { rerender } = render(group(false));
    const label = screen.getByRole("button", { name: "Notes" });
    const contentId = label.getAttribute("aria-controls");
    expect(contentId).not.toBeNull();
    const content = document.getElementById(contentId ?? "");
    expect(content).not.toBeNull();
    expect(content?.hasAttribute("inert")).toBe(true);
    expect(content?.hasAttribute("aria-hidden")).toBe(false);

    rerender(group(true));
    expect(content?.hasAttribute("inert")).toBe(false);
  });
});
