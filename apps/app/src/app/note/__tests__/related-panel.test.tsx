// @vitest-environment jsdom

// The related section under the backlinks one. What it must not do is present
// an inferred list as if it were a counted one: every row carries the scorer's
// own reasons, and "still loading" stays distinguishable from "nothing is
// related" — the two states a reader would otherwise read as one empty answer.

import type { RelatedNoteWire } from "@repo/server-contract/knowledge";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelatedPanel, relatedSummary } from "../related-panel";

afterEach(cleanup);

const related = (over: Partial<RelatedNoteWire> = {}): RelatedNoteWire => ({
  path: "projects/Roadmap.md",
  title: "Roadmap",
  score: 5,
  reasons: ["both link to Welcome", "shares #project"],
  ...over,
});

describe("counting related notes", () => {
  it("counts what it SHOWS, because a ranked top-N has no honest remainder", () => {
    expect(relatedSummary(0)).toBe("No related notes");
    expect(relatedSummary(1)).toBe("1 related note");
    expect(relatedSummary(8)).toBe("8 related notes");
  });
});

describe("the panel", () => {
  it("gives every row the reasons it is there, and opens the note", () => {
    const onOpen = vi.fn();
    render(
      <RelatedPanel
        related={[related(), related({ path: "Daily/2026-08-17.md", title: "Wednesday" })]}
        loading={false}
        failed={false}
        open
        onOpenChange={vi.fn()}
        onOpen={onOpen}
      />,
    );

    expect(screen.getByText("2 related notes")).toBeDefined();
    // The reasons are the whole point of the panel — a row without them is a
    // ranking nobody can check.
    expect(screen.getAllByText("both link to Welcome · shares #project")).toHaveLength(2);
    fireEvent.click(screen.getByText("Roadmap"));

    expect(onOpen).toHaveBeenCalledWith("projects/Roadmap.md");
  });

  it("holds the count back while the query is still out", () => {
    render(
      <RelatedPanel
        related={[]}
        loading
        failed={false}
        open
        onOpenChange={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.queryByText("No related notes")).toBeNull();
    expect(screen.getByText("Related notes")).toBeDefined();
  });

  it("says which signals came up empty, not just that nothing did", () => {
    render(
      <RelatedPanel
        related={[]}
        loading={false}
        failed={false}
        open
        onOpenChange={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Nothing else in the vault shares this note's links, tags or words."),
    ).toBeDefined();
  });

  it("says the read refused rather than counting zero related notes", () => {
    // A refused read is not an answer of "none" — the panel would otherwise
    // report a fact about the vault that it never learned.
    render(
      <RelatedPanel
        related={[]}
        loading={false}
        failed
        open
        onOpenChange={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.queryByText("No related notes")).toBeNull();
    expect(screen.getByText("Could not read the index just now.")).toBeDefined();
  });

  it("collapses to its header, keeping the count in reach", () => {
    const onOpenChange = vi.fn();
    render(
      <RelatedPanel
        related={[related()]}
        loading={false}
        failed={false}
        open={false}
        onOpenChange={onOpenChange}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByText("1 related note")).toBeDefined();
    expect(screen.queryByText("Roadmap")).toBeNull();

    fireEvent.click(screen.getByText("1 related note"));

    // Base UI hands the handler its own event detail as a second argument;
    // only the first is this panel's contract.
    expect(onOpenChange.mock.calls[0]?.[0]).toBe(true);
  });
});
