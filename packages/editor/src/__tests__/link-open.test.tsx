// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import type { Value } from "platejs";
import { describe, expect, it, vi } from "vitest";

import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import { buildResolver } from "@repo/notes/knowledge/link-resolve";

import { EditorHarness } from "./editor-harness";
import { installFakeEditorHost } from "./fake-editor-host";

const LISTING = ["notes/Plan B.md", "x/doc.md"];

const openPopover = (url: string) => {
  const resolver = buildResolver(LISTING);
  const host = installFakeEditorHost({
    resolveMdTarget: (target, fromPath) => resolver.resolveMd(target, fromPath),
  });
  const store = createOpenNoteStore();
  store.publishOpenPath("x/doc.md");
  const value: Value = [
    { children: [{ children: [{ text: "the plan" }], type: "a", url }], type: "p" },
  ];
  render(<EditorHarness value={value} store={store} />);
  fireEvent.click(screen.getByText("the plan"));
  return host.calls;
};

describe("a link's Open", () => {
  it("opens a vault url in the app, at the path the knowledge index resolves", async () => {
    const calls = openPopover("../notes/Plan%20B.md#goals");
    fireEvent.click(await screen.findByRole("button", { name: "Open link" }));
    expect(calls).toEqual([{ action: "openFile", args: ["notes/Plan B.md"] }]);
  });

  it("offers no Open for a vault url the listing does not hold", async () => {
    openPopover("../notes/Nowhere.md");
    await screen.findByRole("button", { name: "Edit link" });
    expect(screen.queryByRole("button", { name: "Open link" })).toBeNull();
  });

  it("hands an external url to the browser", async () => {
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    const calls = openPopover("https://example.com/plan");
    fireEvent.click(await screen.findByRole("button", { name: "Open link" }));
    expect(opened).toHaveBeenCalledWith("https://example.com/plan", "_blank");
    expect(calls).toEqual([]);
    opened.mockRestore();
  });
});
