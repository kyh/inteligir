import { describe, expect, it } from "vitest";
import { internalNextPath } from "../next-path";

describe("the sign-in return path", () => {
  it("carries a same-document path's query through unchanged", () => {
    const href = `/app/devices?highlight=${encodeURIComponent("dev_1")}&name=Work+laptop`;

    const returned = internalNextPath(href);
    expect(returned).toBe(href);

    const search = new URLSearchParams(new URL(returned ?? "", "http://x.test").search);
    expect(search.get("highlight")).toBe("dev_1");
    expect(search.get("name")).toBe("Work laptop");
  });

  it("keeps a fragment, which is part of where someone was", () => {
    expect(internalNextPath("/app/devices?tab=all#row-3")).toBe("/app/devices?tab=all#row-3");
  });

  it("refuses everything that leaves this origin", () => {
    for (const value of [
      undefined,
      "",
      "https://evil.example/steal",
      "//evil.example/steal",
      "/\\evil.example/steal",
      "http:/evil.example",
      "javascript:alert(1)",
      "app/devices",
    ]) {
      expect(internalNextPath(value), String(value)).toBeNull();
    }
  });
});
