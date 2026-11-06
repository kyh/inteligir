import { describe, expect, it } from "vitest";

import { noteIdOfProperties, parseProperties } from "@repo/notes/markdown/frontmatter";
import type { TypedProperty } from "@repo/notes/markdown/frontmatter";

const props = (yaml: string): TypedProperty[] => {
  const parsed = parseProperties(yaml);
  if (parsed.kind !== "valid") {
    throw new Error(`expected valid, got ${parsed.kind}`);
  }
  return parsed.properties;
};

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
    expect(props("a: 2026-07-01T10:00\n")).toEqual([
      { key: "a", type: "text", value: "2026-07-01T10:00" },
    ]);
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
    const [nested] = parsed;
    if (nested?.type !== "unsupported") {
      throw new Error("expected unsupported");
    }
    expect(nested.rawYaml).toBe("a: 1\n  b: 2");
  });

  it("preserves key order", () => {
    expect(props("z: 1\na: 2\nm: 3\n").map((p) => p.key)).toEqual(["z", "a", "m"]);
  });
});

const idOf = (yaml: string): string | null => noteIdOfProperties(parseProperties(yaml));

describe("noteIdOfProperties", () => {
  it("reads a text id and nothing else", () => {
    expect(idOf("id: abc\n")).toBe("abc");
    expect(idOf("id: 42\n")).toBeNull();
    expect(idOf("id:\n")).toBeNull();
    expect(idOf("")).toBeNull();
    expect(noteIdOfProperties(null)).toBeNull();
  });
});
