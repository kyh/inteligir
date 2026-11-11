// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import type { Value } from "platejs";
import { describe, expect, it, vi } from "vitest";

import { EditorHarness } from "./test-support/editor-harness";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

const openPopover = (url: string) => {
  const host = installFakeEditorHost();
  const value: Value = [
    { children: [{ children: [{ text: "the plan" }], type: "a", url }], type: "p" },
  ];
  render(<EditorHarness value={value} />);
  fireEvent.click(screen.getByText("the plan"));
  return host.calls;
};

const anchorOf = (url: string): HTMLAnchorElement | null => {
  openPopover(url);
  return screen.getByText("the plan").closest("a");
};

describe("a link's Open", () => {
  it("hands an external url to the browser, with no handle back to this window", async () => {
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    const calls = openPopover("https://example.com/plan");
    fireEvent.click(await screen.findByRole("button", { name: "Open link" }));
    expect(opened).toHaveBeenCalledWith(
      "https://example.com/plan",
      "_blank",
      "noopener,noreferrer",
    );
    expect(calls).toStrictEqual([]);
    opened.mockRestore();
  });

  it.each([
    "../notes/Plan%20B.md",
    // oxlint-disable-next-line no-script-url -- the refused scheme is this test's input, not a live URL.
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,<script>alert(1)</script>",
  ])("offers no Open for %s, since an item is linked by [[…]]", async (url) => {
    const calls = openPopover(url);
    await screen.findByRole("button", { name: "Edit link" });
    expect(screen.queryByRole("button", { name: "Open link" })).toBeNull();
    expect(calls).toStrictEqual([]);
  });
});

describe("a link's href", () => {
  it("keeps an http(s) url", () => {
    expect(anchorOf("https://example.com/plan")?.getAttribute("href")).toBe(
      "https://example.com/plan",
    );
  });

  it.each([
    // oxlint-disable-next-line no-script-url -- the refused scheme is this test's input, not a live URL.
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,<script>alert(1)</script>",
  ])("drops %s, which a middle-click or a drag would otherwise follow", (url) => {
    const anchor = anchorOf(url);
    expect(anchor).not.toBeNull();
    expect(anchor?.hasAttribute("href")).toBe(false);
  });
});
