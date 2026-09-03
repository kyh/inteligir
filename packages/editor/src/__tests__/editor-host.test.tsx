import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import WikiChip from "@repo/editor/wiki-chip";
import { installFakeEditorHost, type FakeEditorHostOptions } from "./fake-editor-host";

afterEach(cleanup);

function mountChip(body: string, options?: FakeEditorHostOptions) {
  const { calls } = installFakeEditorHost(options ?? {});
  render(<WikiChip body={body} />);
  return calls;
}

describe("a wiki chip over a controlled host", () => {
  it("navigates to the path the host's listing resolved", () => {
    const calls = mountChip("Roadmap", {
      resolveWikiTarget: (target) => (target === "Roadmap" ? "notes/roadmap.md" : null),
    });

    fireEvent.click(screen.getByRole("button", { name: "Roadmap" }));
    expect(calls).toEqual([{ action: "openFile", args: ["notes/roadmap.md"] }]);
  });

  it("offers to create a target the listing does not resolve, and creates nothing until asked", () => {
    const calls = mountChip("Someday");

    fireEvent.click(screen.getByRole("button", { name: "Someday" }));
    expect(calls).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: /Create/ }));
    expect(calls).toEqual([{ action: "createFile", args: ["Someday"] }]);
  });

  it("does nothing at all for a pure-anchor link, which points at the open note", () => {
    const calls = mountChip("#section");

    fireEvent.click(screen.getByRole("button", { name: "#section" }));
    expect(calls).toEqual([]);
    expect(screen.queryByRole("button", { name: /Create/ })).toBeNull();
  });
});
