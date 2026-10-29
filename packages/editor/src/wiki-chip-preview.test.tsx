import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import WikiChip from "@repo/editor/wiki/wiki-chip";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";
import { wikiFieldsOfBody } from "@repo/editor/wiki/wiki-node";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the wiki chip's hover preview", () => {
  it("opens after the hover delay and names an unresolved target as not created", () => {
    installFakeEditorHost({});
    render(<WikiChip link={wikiFieldsOfBody("Someday")} />);
    const chip = screen.getByRole("button", { name: "Someday" });
    fireEvent.pointerEnter(chip, { pointerType: "mouse" });
    fireEvent.mouseEnter(chip);
    fireEvent.mouseMove(chip);
    expect(screen.queryByText(/Not created yet/u)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByText(/Not created yet/u)).toBeDefined();
  });
});

describe("a wiki chip that names its item by id", () => {
  it("shows the name the item goes by now, not the one it was written with", () => {
    const id = "0190a000-0000-7000-8000-000000000001";
    installFakeEditorHost({
      wikiTargets: [{ id, path: "Renamed.md", title: "Renamed", type: "doc" }],
    });
    render(<WikiChip link={wikiFieldsOfBody(`Old name|${id}`)} />);
    expect(screen.getByRole("button", { name: "Renamed" })).toBeDefined();
  });
});
