// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { foldTags, tagScopeCountLabel, TagsView } from "../tags-view";

afterEach(cleanup);

describe("the scoped list's count", () => {
  it("says the whole count, and 'listed of total' while the listing is cut", () => {
    expect(tagScopeCountLabel({ listed: 3, total: 3 })).toBe("3");
    expect(tagScopeCountLabel({ listed: 100, total: 250 })).toBe("100 of 250");
  });
});

const TAGS = [
  { count: 3, tag: "project" },
  { count: 2, tag: "area/deep" },
  { count: 1, tag: "area" },
  { count: 4, tag: "area/wide" },
  { count: 1, tag: "idea" },
];

describe("folding tags by /", () => {
  it("gives every level a row and sums the family into the parent", () => {
    const roots = foldTags(TAGS);
    expect(roots.map((node) => [node.tag, node.count, node.total])).toEqual([
      ["area", 1, 7],
      ["project", 3, 3],
      ["idea", 1, 1],
    ]);
    const [area] = roots;
    expect(area?.children.map((node) => [node.name, node.total])).toEqual([
      ["wide", 4],
      ["deep", 2],
    ]);
  });

  it("makes a parent row for a level no note uses bare", () => {
    const roots = foldTags([{ count: 1, tag: "a/b/c" }]);
    expect(roots.map((node) => [node.tag, node.count, node.total])).toEqual([["a", 0, 1]]);
    expect(roots[0]?.children[0]?.tag).toBe("a/b");
  });
});

describe("the tags view", () => {
  it("lists roots folded, expands a family, and answers select and rename", () => {
    const onSelect = vi.fn<(tag: string) => void>();
    const onRename = vi.fn<(tag: string) => void>();
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
      <TagsView
        tags={[]}
        loaded={false}
        onSelect={vi.fn<(tag: string) => void>()}
        onRename={vi.fn<(tag: string) => void>()}
      />,
    );
    expect(screen.queryByText(/No tags yet/u)).toBeNull();
    rerender(
      <TagsView
        tags={[]}
        loaded
        onSelect={vi.fn<(tag: string) => void>()}
        onRename={vi.fn<(tag: string) => void>()}
      />,
    );
    expect(screen.getByText(/No tags yet/u)).toBeDefined();
  });
});
