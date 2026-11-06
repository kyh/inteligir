import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import WikiChip from "@repo/editor/wiki/wiki-chip";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";
import type { FakeEditorHostOptions } from "@repo/editor/test-support/fake-editor-host";
import { wikiFieldsOfBody } from "@repo/editor/wiki/wiki-node";

afterEach(cleanup);

const mountChip = (body: string, options?: FakeEditorHostOptions) => {
  const { calls } = installFakeEditorHost(options ?? {});
  render(<WikiChip link={wikiFieldsOfBody(body)} />);
  return calls;
};

describe("a wiki chip over a controlled host", () => {
  it("opens the item the host's resolver names, by its id", () => {
    const calls = mountChip("Roadmap", {
      linkTargets: [{ id: "0190a000-0000-7000-8000-000000000001", title: "Roadmap" }],
    });

    fireEvent.click(screen.getByRole("button", { name: "Roadmap" }));
    expect(calls).toStrictEqual([
      { action: "openItem", args: ["0190a000-0000-7000-8000-000000000001"] },
    ]);
  });

  it("offers to make a note no item answers to, and makes nothing until asked", () => {
    const calls = mountChip("Someday");

    fireEvent.click(screen.getByRole("button", { name: "Someday" }));
    expect(calls).toStrictEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Create Someday" }));
    expect(calls).toStrictEqual([
      { action: "createNote", args: [{ blocks: [], title: "Someday" }] },
    ]);
  });

  it("does nothing at all for a pure-anchor link, which points at the open note", () => {
    const calls = mountChip("#section");

    fireEvent.click(screen.getByRole("button", { name: "#section" }));
    expect(calls).toStrictEqual([]);
    expect(screen.queryByRole("button", { name: /Create/u })).toBeNull();
  });
});
