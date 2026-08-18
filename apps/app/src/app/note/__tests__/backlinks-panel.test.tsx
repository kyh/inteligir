// @vitest-environment jsdom

// The backlinks section under the document: it counts what the vault holds
// rather than what fits, it opens the note a row names, and it tells "still
// loading" apart from "nothing links here" — the two states a reader would
// otherwise read as the same empty answer.

import type { BacklinkEntryWire } from "@repo/server-contract/knowledge";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BacklinksPanel, backlinkLabel, backlinksSummary } from "../backlinks-panel";

afterEach(cleanup);

const backlink = (over: Partial<BacklinkEntryWire> = {}): BacklinkEntryWire => ({
  sourcePath: "projects/Roadmap.md",
  line: 12,
  snippet: "blocked on [[Welcome]]",
  kind: "wiki",
  embed: false,
  ...over,
});

describe("naming a backlink", () => {
  it("shows the note's own name, not its path or extension", () => {
    expect(backlinkLabel("projects/Q3/Roadmap.md")).toBe("Roadmap");
    expect(backlinkLabel("README")).toBe("README");
  });

  it("counts what the VAULT holds, and says so when the list was cut", () => {
    expect(backlinksSummary(0, 0)).toBe("No linked mentions");
    expect(backlinksSummary(1, 1)).toBe("1 linked mention");
    expect(backlinksSummary(2, 2)).toBe("2 linked mentions");
    // The route caps at 500; a summary counting the array would quietly
    // under-report a vault that hit it.
    expect(backlinksSummary(500, 812)).toBe("812 linked mentions (500 shown)");
  });
});

describe("the panel", () => {
  it("lists each mention with the line it sits on, and opens the source", () => {
    const onOpen = vi.fn();
    render(
      <BacklinksPanel
        backlinks={[backlink(), backlink({ sourcePath: "Daily/2026-08-17.md", line: 3 })]}
        total={2}
        loading={false}
        open
        onOpenChange={vi.fn()}
        onOpen={onOpen}
      />,
    );

    expect(screen.getByText("2 linked mentions")).toBeDefined();
    fireEvent.click(screen.getByText("Roadmap"));

    expect(onOpen).toHaveBeenCalledWith("projects/Roadmap.md");
  });

  it("holds the count back while the query is still out", () => {
    render(
      <BacklinksPanel
        backlinks={[]}
        total={0}
        loading
        open
        onOpenChange={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    // "No linked mentions" before the answer arrives is a claim the panel
    // cannot make yet.
    expect(screen.queryByText("No linked mentions")).toBeNull();
    expect(screen.getByText("Linked mentions")).toBeDefined();
  });

  it("says plainly that nothing links here", () => {
    render(
      <BacklinksPanel
        backlinks={[]}
        total={0}
        loading={false}
        open
        onOpenChange={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByText("No other note links here yet.")).toBeDefined();
  });

  it("collapses to its header, keeping the count in reach", () => {
    const onOpenChange = vi.fn();
    render(
      <BacklinksPanel
        backlinks={[backlink()]}
        total={1}
        loading={false}
        open={false}
        onOpenChange={onOpenChange}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByText("1 linked mention")).toBeDefined();
    expect(screen.queryByText("Roadmap")).toBeNull();

    fireEvent.click(screen.getByText("1 linked mention"));

    // Base UI hands the handler its own event detail as a second argument;
    // only the first is this panel's contract.
    expect(onOpenChange.mock.calls[0]?.[0]).toBe(true);
  });
});
