// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RelatedRows,
  linkedMentionsSummary,
  groupBacklinks,
  plainSnippet,
  unlinkedMentionDetail,
} from "../related-section";
import type { RelatedRow } from "../related-section";

afterEach(cleanup);

describe("the mentions count", () => {
  it("counts what the VAULT holds, and says so when the list was cut", () => {
    expect(linkedMentionsSummary(1, 1)).toBe("1 linked mention");
    expect(linkedMentionsSummary(2, 2)).toBe("2 linked mentions");
    expect(linkedMentionsSummary(500, 812)).toBe("812 linked mentions (500 shown)");
  });
});

const rows: RelatedRow[] = [
  { detail: "Links here · blocked on [[Welcome]]", label: "Roadmap", path: "projects/Roadmap.md" },
  { detail: "2 shared links · tag #planning", label: "Meeting Notes", path: "Meeting Notes.md" },
];

describe("the unfolded list", () => {
  it("renders both kinds of row with their reasons, and opens on click", () => {
    const onOpenDoc = vi.fn<(path: string) => void>();
    render(
      <RelatedRows
        rows={rows}
        settledEmpty={false}
        suggestionsFailed={false}
        onOpenDoc={onOpenDoc}
      />,
    );
    expect(screen.getByText("Links here · blocked on [[Welcome]]")).toBeTruthy();
    expect(screen.getByText("2 shared links · tag #planning")).toBeTruthy();
    fireEvent.click(screen.getByText("Meeting Notes"));
    expect(onOpenDoc).toHaveBeenCalledWith("Meeting Notes.md");
  });

  it("tells loading apart from a settled empty answer", () => {
    const { rerender } = render(
      <RelatedRows
        rows={[]}
        settledEmpty={false}
        suggestionsFailed={false}
        onOpenDoc={vi.fn<(path: string) => void>()}
      />,
    );
    expect(screen.getByText("…")).toBeTruthy();
    rerender(
      <RelatedRows
        rows={[]}
        settledEmpty
        suggestionsFailed={false}
        onOpenDoc={vi.fn<(path: string) => void>()}
      />,
    );
    expect(
      screen.getByText("Nothing links here or shares this note's links, tags or words."),
    ).toBeTruthy();
  });

  it("a refused suggestions read leaves the mentions standing and says so", () => {
    render(
      <RelatedRows
        rows={[rows[0] ?? { detail: "x", label: "x", path: "x" }]}
        settledEmpty={false}
        suggestionsFailed
        onOpenDoc={vi.fn<(path: string) => void>()}
      />,
    );
    expect(screen.getByText("Roadmap")).toBeTruthy();
    expect(screen.getByText("Could not read suggestions just now.")).toBeTruthy();
  });
});

describe("linked-mention previews", () => {
  it("renders the linking sentence as prose, not dialect bytes", () => {
    expect(plainSnippet("- A [[Getting Started#Lists|the tour]] mention")).toBe(
      "A the tour mention",
    );
    expect(plainSnippet("> Cost is {{2*3|6}} today")).toBe("Cost is 6 today");
    expect(plainSnippet("%%i:abc:start%%Reviewed%%i:abc:end%%")).toBe("Reviewed");
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

describe("an unlinked mention row", () => {
  it("carries the sentence and a Link button that runs beside opening the note", () => {
    const onOpenDoc = vi.fn<(path: string) => void>();
    const run = vi.fn<() => void>();
    render(
      <RelatedRows
        rows={[
          {
            action: { label: "Link", run },
            detail: "Mentions · We revisit the roadmap on Monday.",
            label: "a",
            path: "notes/a.md",
          },
        ]}
        settledEmpty={false}
        suggestionsFailed={false}
        onOpenDoc={onOpenDoc}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(onOpenDoc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("a"));
    expect(onOpenDoc).toHaveBeenCalledWith("notes/a.md");
  });

  it("spells the sentence as prose, with the count when there are several", () => {
    const mention = {
      after: " and [[b|B]]",
      before: "> ",
      column: 0,
      count: 3,
      length: 7,
      line: 1,
      path: "a.md",
      text: "roadmap",
      title: "a",
    };
    expect(unlinkedMentionDetail(mention)).toBe("Mentions 3× · roadmap and B");
    expect(unlinkedMentionDetail({ ...mention, count: 1 })).toBe("Mentions · roadmap and B");
  });
});
