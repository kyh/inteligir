// The seam between the editor and the shell that mounts it, driven through the
// component furthest from either: a wiki chip, which sits inside the Plate tree
// and reaches the shell for both of the things it can do.
//
// The chip has no vault, no Bridge and no workspace under it here — only the
// injected host — which is the whole point of the seam. If a capability the
// editor already owns leaks back into `VaultActions`, this file is where it
// shows up as a port nobody could substitute.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EditorHostProvider } from "@repo/editor/host";
import WikiChip from "@repo/editor/wiki-chip";
import {
  fakeEditorHost,
  type FakeEditorHostOptions,
} from "@repo/editor/__tests__/fake-editor-host";

afterEach(cleanup);

function mountChip(body: string, options?: FakeEditorHostOptions) {
  const { host, calls } = fakeEditorHost(options ?? {});
  render(
    <EditorHostProvider host={host}>
      <WikiChip body={body} />
    </EditorHostProvider>,
  );
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
    // The click opened the offer; it did not write a file.
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
