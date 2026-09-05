// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { foldTags, TagsView } from "../tags-view";

afterEach(cleanup);

const TAGS = [
  { tag: "project", count: 3 },
  { tag: "area/deep", count: 2 },
  { tag: "area", count: 1 },
  { tag: "area/wide", count: 4 },
  { tag: "idea", count: 1 },
];

describe("folding tags by /", () => {
  it("gives every level a row and sums the family into the parent", () => {
    const roots = foldTags(TAGS);
    expect(roots.map((node) => [node.tag, node.count, node.total])).toEqual([
      ["area", 1, 7],
      ["project", 3, 3],
      ["idea", 1, 1],
    ]);
    const area = roots[0];
    expect(area?.children.map((node) => [node.name, node.total])).toEqual([
      ["wide", 4],
      ["deep", 2],
    ]);
  });

  it("makes a parent row for a level no note uses bare", () => {
    const roots = foldTags([{ tag: "a/b/c", count: 1 }]);
    expect(roots.map((node) => [node.tag, node.count, node.total])).toEqual([["a", 0, 1]]);
    expect(roots[0]?.children[0]?.tag).toBe("a/b");
  });
});

describe("the tags view", () => {
  it("lists roots folded, expands a family, and answers select and rename", () => {
    const onSelect = vi.fn();
    const onRename = vi.fn();
    render(<TagsView tags={TAGS} loaded onSelect={onSelect} onRename={onRename} />);
    expect(screen.queryByText("#deep")).toBeNull();
    fireEvent.click(screen.getByLabelText("Expand area"));
    expect(screen.getByText("#deep")).toBeDefined();
    fireEvent.click(screen.getByText("#deep"));
    expect(onSelect).toHaveBeenCalledWith("area/deep");
    fireEvent.click(screen.getByLabelText("Rename project"));
    expect(onRename).toHaveBeenCalledWith("project");
  });

  it("says why it is empty once the index has answered, and not before", () => {
    const { rerender } = render(
      <TagsView tags={[]} loaded={false} onSelect={vi.fn()} onRename={vi.fn()} />,
    );
    expect(screen.queryByText(/No tags yet/)).toBeNull();
    rerender(<TagsView tags={[]} loaded onSelect={vi.fn()} onRename={vi.fn()} />);
    expect(screen.getByText(/No tags yet/)).toBeDefined();
  });
});
