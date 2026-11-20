import { describe, expect, it } from "vitest";

import { canonicalJson, sameJson } from "./canonical-json";

describe(canonicalJson, () => {
  it("sorts keys at every depth and leaves undefined members out", () => {
    expect(canonicalJson({ b: [{ z: 1, a: null }], a: "x", c: undefined })).toBe(
      '{"a":"x","b":[{"a":null,"z":1}]}',
    );
    expect(sameJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameJson([1, 2], [2, 1])).toBe(false);
  });
});
