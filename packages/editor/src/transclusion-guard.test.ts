import { describe, expect, it } from "vitest";

import { decideTransclusion } from "@repo/editor/transclusion-guard";

describe(decideTransclusion, () => {
  it("renders a resolved embed", () => {
    expect(decideTransclusion("hub", "target")).toStrictEqual({ itemId: "target", kind: "render" });
  });

  it("chips an unresolved target", () => {
    expect(decideTransclusion("hub", null)).toStrictEqual({ kind: "chip", reason: "unresolved" });
  });

  it("chips an item embedding itself as a cycle", () => {
    expect(decideTransclusion("hub", "hub")).toStrictEqual({ kind: "chip", reason: "cycle" });
  });

  it("renders any resolved embed outside an open item", () => {
    expect(decideTransclusion(null, "target")).toStrictEqual({ itemId: "target", kind: "render" });
  });
});
