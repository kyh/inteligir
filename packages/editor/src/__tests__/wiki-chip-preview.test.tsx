import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import WikiChip from "@repo/editor/wiki-chip";
import { installFakeEditorHost } from "./fake-editor-host";

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
    render(<WikiChip body="Someday" />);
    const chip = screen.getByRole("button", { name: "Someday" });
    fireEvent.pointerEnter(chip, { pointerType: "mouse" });
    fireEvent.mouseEnter(chip);
    fireEvent.mouseMove(chip);
    expect(screen.queryByText(/Not created yet/)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByText(/Not created yet/)).toBeDefined();
  });
});
