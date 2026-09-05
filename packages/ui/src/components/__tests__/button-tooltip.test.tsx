// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Button } from "../button";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function hover(element: HTMLElement): void {
  fireEvent.pointerEnter(element, { pointerType: "mouse" });
  fireEvent.mouseEnter(element);
  fireEvent.mouseMove(element);
  act(() => {
    vi.advanceTimersByTime(400);
  });
}

describe("an icon-only button", () => {
  it("shows its label as a tooltip on hover", () => {
    render(
      <Button size="icon-compact" aria-label="Copy link">
        <svg />
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Copy link" });
    expect(screen.queryByText("Copy link")).toBeNull();
    hover(button);
    expect(screen.getByText("Copy link")).toBeDefined();
  });

  it("takes a title as its label and drops the native tooltip", () => {
    render(
      <Button size="icon" title="Bold ⌘B">
        <svg />
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Bold ⌘B" });
    expect(button.getAttribute("title")).toBeNull();
    hover(button);
    expect(screen.getByText("Bold ⌘B")).toBeDefined();
  });
});

describe("a button with a label on its face", () => {
  it("keeps its title and gets no tooltip", () => {
    render(
      <Button size="compact" title="Saves the note">
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.getAttribute("title")).toBe("Saves the note");
    hover(button);
    expect(screen.queryByText("Saves the note")).toBeNull();
  });
});
