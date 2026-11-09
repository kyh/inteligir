import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLibraryTitles } from "@repo/editor/host-io";
import { MentionChip } from "@repo/editor/mention/mention-chip";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const hover = (chip: HTMLElement): void => {
  fireEvent.pointerEnter(chip, { pointerType: "mouse" });
  fireEvent.mouseEnter(chip);
  fireEvent.mouseMove(chip);
};

describe("a page link's chip", () => {
  it("shows the name the item goes by now, not the one it was written with", () => {
    const id = "0190a000-0000-7000-8000-000000000001";
    installFakeEditorHost({ titles: [{ id, title: "Renamed" }] });
    render(<MentionChip itemId={id} title="Old name" />);
    expect(screen.getByRole("button", { name: "Renamed" })).toBeDefined();
  });

  it("takes the item's new name once the library's titles move", () => {
    const id = "0190a000-0000-7000-8000-000000000001";
    installFakeEditorHost({ titles: [{ id, title: "Plan" }] });
    render(<MentionChip itemId={id} title="Plan" />);
    act(() => {
      setLibraryTitles([{ id, title: "Quarterly plan" }]);
    });
    expect(screen.getByRole("button", { name: "Quarterly plan" })).toBeDefined();
  });

  it("previews the item's first lines after the hover delay and opens it by its id", async () => {
    const id = "0190a000-0000-7000-8000-000000000002";
    const { calls } = installFakeEditorHost({
      itemBlocks: (itemId) =>
        itemId === id
          ? [{ children: [{ text: "The plan, in short." }], id: "b1", type: "p" }]
          : null,
      titles: [{ id, title: "Plan" }],
    });
    render(<MentionChip itemId={id} title="Plan" />);
    const chip = screen.getByRole("button", { name: "Plan" });
    hover(chip);
    expect(screen.queryByText("The plan, in short.")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(screen.getByText("The plan, in short.")).toBeDefined();
    fireEvent.click(chip);
    expect(calls).toStrictEqual([{ action: "openItem", args: [id] }]);
  });

  it("previews nothing for an item the host does not feed", async () => {
    installFakeEditorHost({});
    render(<MentionChip itemId="0190a000-0000-7000-8000-000000000003" title="Gone" />);
    hover(screen.getByRole("button", { name: "Gone" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(screen.queryByRole("button", { name: "Gone" })).not.toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(1);
  });
});
