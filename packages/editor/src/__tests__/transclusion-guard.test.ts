import { describe, expect, it } from "vitest";

import { decideTransclusion } from "@repo/editor/transclusion-guard";

describe("decideTransclusion", () => {
  it("renders a resolved embed", () => {
    expect(decideTransclusion("hub.md", "target.md")).toEqual({
      kind: "render",
      path: "target.md",
    });
  });

  it("chips an unresolved target", () => {
    expect(decideTransclusion("hub.md", null)).toEqual({
      kind: "chip",
      reason: "unresolved",
    });
  });

  it("chips a self-embed as a cycle", () => {
    expect(decideTransclusion("hub.md", "hub.md")).toEqual({ kind: "chip", reason: "cycle" });
  });

  it("renders any resolved embed while no note is open", () => {
    expect(decideTransclusion(null, "target.md")).toEqual({ kind: "render", path: "target.md" });
  });
});
