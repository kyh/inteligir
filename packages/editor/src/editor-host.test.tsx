import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import WikiChip from "@repo/editor/wiki/wiki-chip";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";
import type { FakeEditorHostOptions } from "@repo/editor/test-support/fake-editor-host";

afterEach(cleanup);

const ROADMAP = "0190a000-0000-7000-8000-000000000001";

const mountChip = (itemId: string, title: string, options?: FakeEditorHostOptions) => {
  const { calls } = installFakeEditorHost(options ?? {});
  render(<WikiChip itemId={itemId} title={title} />);
  return calls;
};

describe("a page link's chip over a controlled host", () => {
  it("opens the item it names by its id, under the name the item goes by now", () => {
    const calls = mountChip(ROADMAP, "Old name", {
      linkTargets: [{ id: ROADMAP, title: "Roadmap" }],
    });

    fireEvent.click(screen.getByRole("button", { name: "Roadmap" }));
    expect(calls).toStrictEqual([{ action: "openItem", args: [ROADMAP] }]);
  });

  it("draws the title it was written with for an item the host does not feed, and opens nothing", () => {
    const calls = mountChip(ROADMAP, "Someday");

    fireEvent.click(screen.getByRole("button", { name: "Someday" }));
    expect(calls).toStrictEqual([]);
  });

  it("names an untitled item by the app's word for one", () => {
    mountChip(ROADMAP, "", { linkTargets: [{ id: ROADMAP, title: "" }] });

    expect(screen.getByRole("button", { name: "Untitled" })).not.toBeNull();
  });
});
