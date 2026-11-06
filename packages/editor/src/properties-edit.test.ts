import { describe, expect, it } from "vitest";
import { createSlateEditor } from "platejs";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseProperties } from "@repo/notes/markdown/frontmatter";

import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { parseMarkdown } from "@repo/editor/markdown/markdown-doc";
import { readFrontmatterRaw } from "@repo/editor/properties/properties-node";

const seed = (md: string) => {
  const parsed = parseMarkdown(md);
  if (!parsed.ok) {
    throw new Error("fixture must parse");
  }
  return createSlateEditor({ plugins: EDITOR_KIT, value: parsed.value });
};

const DOC =
  "---\ntitle: Note\ndone: false\ntags:\n  - a\n  - b\nnested:\n  x: 1\n  y: 2\n---\n\n# Body\n\ntext\n";

describe("the frontmatter node", () => {
  it("reads the frontmatter node's raw yaml", () => {
    const editor = seed(DOC);
    expect(readFrontmatterRaw(editor)).toBe(
      "title: Note\ndone: false\ntags:\n  - a\n  - b\nnested:\n  x: 1\n  y: 2",
    );
  });
});

const FIXTURES = fileURLToPath(
  new URL("test-support/fixtures/roundtrip/canonical/", import.meta.url),
);
const fixtureProps = (name: string) => {
  const text = readFileSync(`${FIXTURES}${name}`, "utf-8");
  const match = /^---[ \t]*\r?\n(?<body>[\s\S]*?)\r?\n---/u.exec(text);
  return parseProperties(match?.groups?.body ?? "");
};

describe("round-trip fixtures ↔ typing", () => {
  it("frontmatter-properties.md types every supported kind", () => {
    const parsed = fixtureProps("frontmatter-properties.md");
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

  it("frontmatter-invalid.md is invalid (preserved, never rewritten)", () => {
    expect(fixtureProps("frontmatter-invalid.md").kind).toBe("invalid");
  });
});
