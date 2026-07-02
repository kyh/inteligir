import { describe, expect, it } from "vitest";

import { decideTransclusion, nestedScope } from "@repo/app/editor/transclusion-guard";

const root = (path: string) => ({ depth: 0, chain: [path] });

describe("decideTransclusion", () => {
  it("renders a resolved top-level embed", () => {
    expect(decideTransclusion(root("hub.md"), "target.md")).toEqual({
      kind: "render",
      path: "target.md",
    });
  });

  it("chips an unresolved target", () => {
    expect(decideTransclusion(root("hub.md"), null)).toEqual({
      kind: "chip",
      reason: "unresolved",
    });
  });

  it("chips a self-embed as a cycle", () => {
    expect(decideTransclusion(root("hub.md"), "hub.md")).toEqual({ kind: "chip", reason: "cycle" });
  });

  it("chips embeds inside embedded content (depth guard)", () => {
    const inner = nestedScope(root("hub.md"), "target.md");
    expect(decideTransclusion(inner, "other.md")).toEqual({ kind: "chip", reason: "depth" });
    // Even a would-be cycle at depth is reported as depth — it never renders.
    expect(decideTransclusion(inner, "hub.md")).toEqual({ kind: "chip", reason: "depth" });
  });

  it("nestedScope extends the ancestor chain", () => {
    const inner = nestedScope(root("a.md"), "b.md");
    expect(inner).toEqual({ depth: 1, chain: ["a.md", "b.md"] });
  });
});
