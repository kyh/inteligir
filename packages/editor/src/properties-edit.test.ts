import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseProperties } from "@repo/notes/markdown/frontmatter";

const FIXTURES = fileURLToPath(
  new URL("test-support/fixtures/roundtrip/frontmatter/", import.meta.url),
);
const fixtureProps = (name: string) => {
  const text = readFileSync(`${FIXTURES}${name}`, "utf-8");
  const match = /^---[ \t]*\r?\n(?<body>[\s\S]*?)\r?\n---/u.exec(text);
  return parseProperties(match?.groups?.body ?? "");
};

describe("round-trip fixtures ↔ typing", () => {
  it("properties.md types every supported kind", () => {
    const parsed = fixtureProps("properties.md");
    if (parsed.kind !== "valid") {
      throw new Error("expected valid");
    }
    expect(parsed.properties.map((p) => [p.key, p.type])).toStrictEqual([
      ["title", "text"],
      ["published", "checkbox"],
      ["draft", "checkbox"],
      ["count", "number"],
      ["due", "date"],
      ["maybe", "text"],
      ["tags", "tags"],
      ["nested", "unsupported"],
    ]);
  });

  it("invalid.md is invalid (preserved, never rewritten)", () => {
    expect(fixtureProps("invalid.md").kind).toBe("invalid");
  });
});
