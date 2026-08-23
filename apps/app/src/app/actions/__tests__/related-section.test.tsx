// @vitest-environment jsdom

// The merged Related section (panel): linked mentions keep their count
// semantics and lead the list carrying "Links here" plus the linking
// sentence; the scorer's rows follow carrying their own reasons; a click
// opens the note; and "still loading" reads differently from "nothing".

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RelatedRows,
  linkedMentionsSummary,
  relatedRowLabel,
  type RelatedRow,
  groupBacklinks,
  plainSnippet,
} from "../related-section";

afterEach(cleanup);

describe("row naming and the mentions count", () => {
  it("shows the note's own name, not its path or extension", () => {
    expect(relatedRowLabel("projects/Q3/Roadmap.md")).toBe("Roadmap");
    expect(relatedRowLabel("README")).toBe("README");
  });

  it("counts what the VAULT holds, and says so when the list was cut", () => {
    expect(linkedMentionsSummary(1, 1)).toBe("1 linked mention");
    expect(linkedMentionsSummary(2, 2)).toBe("2 linked mentions");
    // The route caps the list; a summary counting the array would quietly
    // under-report a vault that hit the cap.
    expect(linkedMentionsSummary(500, 812)).toBe("812 linked mentions (500 shown)");
  });
});

const rows: RelatedRow[] = [
  { path: "projects/Roadmap.md", label: "Roadmap", detail: "Links here · blocked on [[Welcome]]" },
  { path: "Meeting Notes.md", label: "Meeting Notes", detail: "2 shared links · tag #planning" },
];

describe("the unfolded list", () => {
  it("renders both kinds of row with their reasons, and opens on click", () => {
    const onOpenDoc = vi.fn();
    render(
      <RelatedRows
        rows={rows}
        settledEmpty={false}
        suggestionsFailed={false}
        onOpenDoc={onOpenDoc}
      />,
    );
    // The counted half carries the linking sentence; the inferred half its
    // scorer reasons — a bare filename row would be a claim nobody can check.
    expect(screen.getByText("Links here · blocked on [[Welcome]]")).toBeTruthy();
    expect(screen.getByText("2 shared links · tag #planning")).toBeTruthy();
    fireEvent.click(screen.getByText("Meeting Notes"));
    expect(onOpenDoc).toHaveBeenCalledWith("Meeting Notes.md");
  });

  it("tells loading apart from a settled empty answer", () => {
    const { rerender } = render(
      <RelatedRows rows={[]} settledEmpty={false} suggestionsFailed={false} onOpenDoc={vi.fn()} />,
    );
    expect(screen.getByText("…")).toBeTruthy();
    rerender(<RelatedRows rows={[]} settledEmpty suggestionsFailed={false} onOpenDoc={vi.fn()} />);
    expect(
      screen.getByText("Nothing links here or shares this note's links, tags or words."),
    ).toBeTruthy();
  });

  it("a refused suggestions read leaves the mentions standing and says so", () => {
    render(
      <RelatedRows
        rows={[rows[0] ?? { path: "x", label: "x", detail: "x" }]}
        settledEmpty={false}
        suggestionsFailed
        onOpenDoc={vi.fn()}
      />,
    );
    expect(screen.getByText("Roadmap")).toBeTruthy();
    expect(screen.getByText("Could not read suggestions just now.")).toBeTruthy();
  });
});

describe("linked-mention previews", () => {
  it("renders the linking sentence as prose, not dialect bytes", () => {
    expect(plainSnippet("- A [[Getting Started with Moss#Lists|the tour]] mention")).toBe(
      "A the tour mention",
    );
    expect(plainSnippet("> Cost is {{2*3|6}} today")).toBe("Cost is 6 today");
    expect(plainSnippet("%%m:abc:start%%Reviewed%%m:abc:end%%")).toBe("Reviewed");
    // A uuid alias is identity, so the title stands in for it.
    expect(plainSnippet("see [[Use Cases|f2745aa0-f394-4469-963d-438f2dd9fd5a]] first")).toBe(
      "see Use Cases first",
    );
  });

  it("groups mentions by their source note", () => {
    const grouped = groupBacklinks([
      { snippet: "first", sourcePath: "a.md" },
      { snippet: "second", sourcePath: "a.md" },
      { snippet: "only", sourcePath: "b.md" },
    ]);
    expect(grouped.map((group) => [group.sourcePath, group.count])).toEqual([
      ["a.md", 2],
      ["b.md", 1],
    ]);
  });
});
