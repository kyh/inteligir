import type { RootContent } from "mdast";
import { describe, expect, it } from "vitest";

import { parseMdast } from "../parse";

const textOf = (node: RootContent): string => {
  if (node.type === "text") {
    return node.value;
  }
  return "children" in node ? node.children.map(textOf).join("") : "";
};

const panelsOf = (md: string): { label: string; text: string }[] => {
  const parsed = parseMdast(md);
  if (!parsed.ok) {
    throw new Error(parsed.failure.message);
  }
  const [group] = parsed.root.children;
  if (group?.type !== "tabGroup") {
    throw new Error(`expected a tab group, got ${group?.type ?? "nothing"}`);
  }
  return group.children.map((panel) => ({
    label: panel.label,
    text: panel.children.map(textOf).join(""),
  }));
};

describe("the :::tabs markers", () => {
  it("read the same under CRLF as under LF, and the `\\r` stays with the terminator", () => {
    const lf = ":::tabs\n=== A\nhello\nthere\n=== B\nworld\n:::\n";
    expect(panelsOf(lf)).toEqual([
      { label: "A", text: "hello\nthere" },
      { label: "B", text: "world" },
    ]);
    expect(panelsOf(lf.replaceAll("\n", "\r\n"))).toEqual([
      { label: "A", text: "hello\r\nthere" },
      { label: "B", text: "world" },
    ]);
  });
});
