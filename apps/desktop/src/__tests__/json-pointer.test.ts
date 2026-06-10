import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";

import { applyJsonPatchOp, JsonPatchOpParam, type JsonPatchOp } from "@/shared/json-pointer";

// Convenience: apply one op to a structuredClone'd document and return it,
// so each assertion reads as input → output without shared mutation.
function applied(doc: unknown, op: JsonPatchOp): unknown {
  const draft = structuredClone(doc);
  applyJsonPatchOp(draft, op);
  return draft;
}

describe("pointer parsing", () => {
  it("rejects a pointer that does not start with '/'", () => {
    expect(() => applyJsonPatchOp({}, { op: "add", path: "a/b", value: 1 })).toThrow(
      /must start with \//,
    );
  });

  it("rejects patching the document root", () => {
    expect(() => applyJsonPatchOp({}, { op: "replace", path: "", value: {} })).toThrow(
      /Cannot patch the document root/,
    );
  });

  it("unescapes ~1 to '/' and ~0 to '~' in segments", () => {
    expect(applied({}, { op: "add", path: "/a~1b", value: 1 })).toEqual({ "a/b": 1 });
    expect(applied({}, { op: "add", path: "/m~0n", value: 2 })).toEqual({ "m~n": 2 });
    // RFC 6901 ordering: '~01' must decode to the literal '~1', not '/'.
    expect(applied({}, { op: "add", path: "/x~01", value: 3 })).toEqual({ "x~1": 3 });
  });
});

describe("object semantics", () => {
  it("add creates a member and overwrites an existing one", () => {
    expect(applied({ a: 1 }, { op: "add", path: "/b", value: 2 })).toEqual({ a: 1, b: 2 });
    expect(applied({ a: 1 }, { op: "add", path: "/a", value: 9 })).toEqual({ a: 9 });
  });

  it("replace sets a member", () => {
    expect(applied({ a: { b: 1 } }, { op: "replace", path: "/a/b", value: 2 })).toEqual({
      a: { b: 2 },
    });
  });

  it("rejects replace of a missing key (RFC 6902: target must exist)", () => {
    expect(() => applyJsonPatchOp({ a: 1 }, { op: "replace", path: "/b", value: 2 })).toThrow(
      /Cannot replace missing key 'b' in \/b/,
    );
  });

  it("rejects replace of a missing key on a nested path, leaving the doc untouched", () => {
    const doc = { a: { b: 1 } };
    expect(() => applyJsonPatchOp(doc, { op: "replace", path: "/a/c", value: 2 })).toThrow(
      /Cannot replace missing key 'c' in \/a\/c/,
    );
    expect(doc).toEqual({ a: { b: 1 } });
  });

  it("remove deletes a member", () => {
    expect(applied({ a: 1, b: 2 }, { op: "remove", path: "/a" })).toEqual({ b: 2 });
  });

  it("rejects traversal through a missing segment", () => {
    expect(() => applyJsonPatchOp({ a: {} }, { op: "add", path: "/ghost/x", value: 1 })).toThrow(
      /does not exist \(missing segment 'ghost'\)/,
    );
  });

  it("rejects traversal through a scalar", () => {
    expect(() => applyJsonPatchOp({ a: 1 }, { op: "add", path: "/a/b/c", value: 1 })).toThrow(
      /traverses non-container/,
    );
  });

  it("rejects a leaf write when the parent is a scalar", () => {
    expect(() => applyJsonPatchOp({ a: 1 }, { op: "add", path: "/a/b", value: 1 })).toThrow(
      /parent is not a container/,
    );
  });
});

describe("array semantics — add", () => {
  it("inserts at an index, shifting later elements", () => {
    expect(applied({ xs: [1, 3] }, { op: "add", path: "/xs/1", value: 2 })).toEqual({
      xs: [1, 2, 3],
    });
    expect(applied({ xs: [2, 3] }, { op: "add", path: "/xs/0", value: 1 })).toEqual({
      xs: [1, 2, 3],
    });
  });

  it("appends at index == length and via '-'", () => {
    expect(applied({ xs: [1] }, { op: "add", path: "/xs/1", value: 2 })).toEqual({ xs: [1, 2] });
    expect(applied({ xs: [1, 2] }, { op: "add", path: "/xs/-", value: 3 })).toEqual({
      xs: [1, 2, 3],
    });
  });

  it("appends to a top-level array document", () => {
    expect(applied([1, 3], { op: "add", path: "/1", value: 2 })).toEqual([1, 2, 3]);
  });

  it("rejects an add past the end", () => {
    expect(() => applyJsonPatchOp({ xs: [1] }, { op: "add", path: "/xs/2", value: 2 })).toThrow(
      /Array index 2 out of bounds for add/,
    );
  });

  it("rejects non-canonical indices instead of aliasing them", () => {
    for (const seg of ["01", "1x", " 2", "-1", "1.5"]) {
      expect(() =>
        applyJsonPatchOp({ xs: [1, 2, 3] }, { op: "add", path: `/xs/${seg}`, value: 9 }),
      ).toThrow(new RegExp(`Bad array index '${seg.replace(".", "\\.")}'`));
    }
  });
});

describe("array semantics — replace", () => {
  it("replaces in place without changing length", () => {
    expect(applied({ xs: [1, 2, 3] }, { op: "replace", path: "/xs/1", value: 9 })).toEqual({
      xs: [1, 9, 3],
    });
  });

  it("rejects replace at index == length (out of bounds)", () => {
    expect(() =>
      applyJsonPatchOp({ xs: [1, 2] }, { op: "replace", path: "/xs/2", value: 9 }),
    ).toThrow(/Array index 2 out of bounds for replace/);
  });

  it("rejects '-' for replace", () => {
    expect(() => applyJsonPatchOp({ xs: [1] }, { op: "replace", path: "/xs/-", value: 9 })).toThrow(
      /'-' index is only valid for add/,
    );
  });
});

describe("array semantics — remove", () => {
  it("removes the element and shifts the rest", () => {
    expect(applied({ xs: [1, 2, 3] }, { op: "remove", path: "/xs/1" })).toEqual({ xs: [1, 3] });
  });

  it("rejects remove at index == length (out of bounds)", () => {
    expect(() => applyJsonPatchOp({ xs: [1, 2] }, { op: "remove", path: "/xs/2" })).toThrow(
      /Array index 2 out of bounds for remove/,
    );
  });

  it("rejects '-' for remove", () => {
    expect(() => applyJsonPatchOp({ xs: [1] }, { op: "remove", path: "/xs/-" })).toThrow(
      /'-' index is only valid for add/,
    );
  });
});

describe("array traversal", () => {
  const doc = { items: [{ name: "a" }, { name: "b" }] };

  it("traverses array indices on the way to the leaf", () => {
    expect(applied(doc, { op: "replace", path: "/items/1/name", value: "c" })).toEqual({
      items: [{ name: "a" }, { name: "c" }],
    });
  });

  it("rejects a non-canonical index mid-path", () => {
    expect(() =>
      applyJsonPatchOp(structuredClone(doc), { op: "replace", path: "/items/01/name", value: "c" }),
    ).toThrow(/Bad array index '01'/);
  });

  it("rejects traversal through a missing element", () => {
    expect(() =>
      applyJsonPatchOp(structuredClone(doc), { op: "replace", path: "/items/5/name", value: "c" }),
    ).toThrow(/does not exist \(missing segment '5'\)/);
  });
});

describe("prototype-pollution guards", () => {
  it.each(["__proto__", "constructor", "prototype"])(
    "refuses to write the reserved key '%s'",
    (key) => {
      expect(() => applyJsonPatchOp({}, { op: "add", path: `/${key}`, value: {} })).toThrow(
        new RegExp(`Refusing to add prototype-reserved key '${key}'`),
      );
      expect(() => applyJsonPatchOp({ x: 1 }, { op: "remove", path: `/${key}` })).toThrow(
        new RegExp(`Refusing to remove prototype-reserved key '${key}'`),
      );
    },
  );

  it("refuses to traverse through a reserved key", () => {
    expect(() =>
      applyJsonPatchOp({}, { op: "add", path: "/__proto__/polluted", value: "x" }),
    ).toThrow(/Refusing to traverse prototype-reserved key '__proto__'/);
    expect(() =>
      applyJsonPatchOp({}, { op: "add", path: "/constructor/prototype/polluted", value: "x" }),
    ).toThrow(/Refusing to traverse prototype-reserved key 'constructor'/);
  });

  it("leaves Object.prototype untouched after refused writes", () => {
    for (const path of ["/__proto__/polluted", "/__proto__"]) {
      try {
        applyJsonPatchOp({}, { op: "add", path, value: { polluted: true } });
      } catch {
        // expected — the guard threw before any write
      }
    }
    const probe: Record<string, unknown> = {};
    expect(probe["polluted"]).toBeUndefined();
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });
});

describe("JsonPatchOpParam schema (boundary contract)", () => {
  it("accepts add/replace with a value and remove without", () => {
    expect(Value.Check(JsonPatchOpParam, { op: "add", path: "/a", value: 1 })).toBe(true);
    expect(Value.Check(JsonPatchOpParam, { op: "replace", path: "/a", value: null })).toBe(true);
    expect(Value.Check(JsonPatchOpParam, { op: "remove", path: "/a" })).toBe(true);
  });

  it("rejects unsupported ops and extra properties", () => {
    expect(Value.Check(JsonPatchOpParam, { op: "move", from: "/a", path: "/b" })).toBe(false);
    expect(Value.Check(JsonPatchOpParam, { op: "remove", path: "/a", value: 1 })).toBe(false);
    expect(Value.Check(JsonPatchOpParam, { op: "add", value: 1 })).toBe(false);
  });
});
