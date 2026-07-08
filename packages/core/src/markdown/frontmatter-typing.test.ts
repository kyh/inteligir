import { describe, expect, it } from "vitest";

import {
  type TypedProperty,
  parseProperties,
  serializeProperties,
} from "@repo/core/markdown/frontmatter";

// Every typing rule from plan 017 (hubble ADR-0003), exhaustively. The rules
// ARE the feature: conservative YAML 1.2 core-schema typing that never coerces
// and never destroys what it can't represent.

function props(yaml: string): TypedProperty[] {
  const parsed = parseProperties(yaml);
  if (parsed.kind !== "valid") throw new Error(`expected valid, got ${parsed.kind}`);
  return parsed.properties;
}

describe("parseProperties — kinds", () => {
  it("empty / whitespace yaml is `none`", () => {
    expect(parseProperties("").kind).toBe("none");
    expect(parseProperties("   \n  ").kind).toBe("none");
  });

  it("malformed yaml is `invalid`", () => {
    expect(parseProperties("a: [1, 2\nb: :\n").kind).toBe("invalid");
  });

  it("duplicate keys are `invalid` (never guessed)", () => {
    expect(parseProperties("a: 1\na: 2\n").kind).toBe("invalid");
  });

  it("a non-mapping root (sequence / scalar) is `invalid`", () => {
    expect(parseProperties("- a\n- b\n").kind).toBe("invalid");
    expect(parseProperties("just a string\n").kind).toBe("invalid");
  });
});

describe("parseProperties — typing rules", () => {
  it("true/false → checkbox", () => {
    expect(props("a: true\nb: false\n")).toEqual([
      { key: "a", type: "checkbox", value: true },
      { key: "b", type: "checkbox", value: false },
    ]);
  });

  it("yes/no/on/off STAY text (no coercion)", () => {
    expect(props("a: yes\nb: no\nc: on\nd: off\n")).toEqual([
      { key: "a", type: "text", value: "yes" },
      { key: "b", type: "text", value: "no" },
      { key: "c", type: "text", value: "on" },
      { key: "d", type: "text", value: "off" },
    ]);
  });

  it("explicit YYYY-MM-DD strings → date; other date-ish strings stay text", () => {
    expect(props("a: 2026-07-01\n")).toEqual([{ key: "a", type: "date", value: "2026-07-01" }]);
    // A timestamp with a time component is not the recognized shape → text.
    expect(props("a: 2026-07-01T10:00\n")).toEqual([
      { key: "a", type: "text", value: "2026-07-01T10:00" },
    ]);
    // A quoted date is still just a string with the date shape → date.
    expect(props('a: "2026-07-01"\n')).toEqual([{ key: "a", type: "date", value: "2026-07-01" }]);
  });

  it("numbers → number", () => {
    expect(props("a: 42\nb: 3.14\nc: -7\n")).toEqual([
      { key: "a", type: "number", value: 42 },
      { key: "b", type: "number", value: 3.14 },
      { key: "c", type: "number", value: -7 },
    ]);
  });

  it("plain strings → text", () => {
    expect(props("title: Hello World\n")).toEqual([
      { key: "title", type: "text", value: "Hello World" },
    ]);
  });

  it("string arrays → tags (block or flow)", () => {
    expect(props("tags:\n  - a\n  - b\n")).toEqual([
      { key: "tags", type: "tags", value: ["a", "b"] },
    ]);
    expect(props("tags: [a, b]\n")).toEqual([{ key: "tags", type: "tags", value: ["a", "b"] }]);
    expect(props("tags: []\n")).toEqual([{ key: "tags", type: "tags", value: [] }]);
  });

  it("nested maps, mixed / non-string arrays and nulls → unsupported", () => {
    const parsed = props("nested:\n  a: 1\n  b: 2\nmixed: [1, two]\nnums: [1, 2]\nempty:\n");
    expect(parsed.map((p) => [p.key, p.type])).toEqual([
      ["nested", "unsupported"],
      ["mixed", "unsupported"],
      ["nums", "unsupported"],
      ["empty", "unsupported"],
    ]);
    // The nested map's raw source bytes are captured for the read-only display.
    const nested = parsed[0];
    if (nested?.type !== "unsupported") throw new Error("expected unsupported");
    expect(nested.rawYaml).toBe("a: 1\n  b: 2");
  });

  it("preserves key order", () => {
    expect(props("z: 1\na: 2\nm: 3\n").map((p) => p.key)).toEqual(["z", "a", "m"]);
  });
});

describe("serializeProperties", () => {
  const prior =
    "title: My Note\ndone: false\ntags:\n  - alpha\n  - beta\nnested:\n  a: 1\n  b: 2\n";

  function edit(mutate: (p: TypedProperty[]) => TypedProperty[]): string {
    return serializeProperties(mutate(props(prior)), prior.trimEnd());
  }

  it("editing one property is a minimal diff; unsupported keys stay byte-exact", () => {
    const out = edit((p) =>
      p.map((prop) =>
        prop.key === "done" ? { key: "done", type: "checkbox", value: true } : prop,
      ),
    );
    expect(out).toBe(
      "title: My Note\ndone: true\ntags:\n  - alpha\n  - beta\nnested:\n  a: 1\n  b: 2",
    );
  });

  it("no edit → identical bytes back", () => {
    expect(edit((p) => p)).toBe(prior.trimEnd());
  });

  it("does NOT coerce a string that looks boolean/numeric (quotes on write)", () => {
    const out = serializeProperties(
      [
        { key: "a", type: "text", value: "true" },
        { key: "b", type: "text", value: "42" },
        { key: "c", type: "text", value: "yes" },
      ],
      "",
    );
    // `true`/`42` are quoted so they re-parse as strings; `yes` needs none
    // (it is already a string under the core schema).
    expect(out).toBe('a: "true"\nb: "42"\nc: yes');
    expect(props(out + "\n")).toEqual([
      { key: "a", type: "text", value: "true" },
      { key: "b", type: "text", value: "42" },
      { key: "c", type: "text", value: "yes" },
    ]);
  });

  it("a date string stays plain (re-parses as date)", () => {
    const out = serializeProperties([{ key: "due", type: "date", value: "2026-12-25" }], "");
    expect(out).toBe("due: 2026-12-25");
    expect(props(out + "\n")).toEqual([{ key: "due", type: "date", value: "2026-12-25" }]);
  });

  it("adding a key appends it; deleting removes only it", () => {
    const added = edit((p) => [...p, { key: "priority", type: "number", value: 1 }]);
    expect(added).toBe(
      "title: My Note\ndone: false\ntags:\n  - alpha\n  - beta\nnested:\n  a: 1\n  b: 2\npriority: 1",
    );
    const removed = edit((p) => p.filter((prop) => prop.key !== "done"));
    expect(removed).toBe("title: My Note\ntags:\n  - alpha\n  - beta\nnested:\n  a: 1\n  b: 2");
  });

  it("clearing every property empties the block", () => {
    expect(serializeProperties([], prior)).toBe("");
  });

  it("round-trips tags edits", () => {
    const out = serializeProperties(
      [{ key: "tags", type: "tags", value: ["x", "y", "z"] }],
      "tags:\n  - a\n",
    );
    expect(props(out + "\n")).toEqual([{ key: "tags", type: "tags", value: ["x", "y", "z"] }]);
  });
});
