import { describe, expect, it } from "vitest";
import { flavorOfMode } from "../build-flavor";

describe("a build's flavor", () => {
  it("is the store's for --mode store, and the dev build's for any other mode", () => {
    expect(flavorOfMode("store")).toBe("store");
    expect(flavorOfMode("dev")).toBe("dev");
    expect(flavorOfMode("production")).toBe("dev");
  });
});
