// The properties panel's edit → serialize flow, driven headlessly against the
// real EDITOR_KIT (the same pipeline the live editor serializes through). It
// proves the one-write-path contract: a property edit becomes a frontmatter-
// node write, and the ordinary Plate serialize emits the note bytes — with
// unsupported YAML preserved byte-for-byte.

import { describe, expect, it } from "vitest";
import { createSlateEditor } from "platejs";
import { serializeMd } from "@platejs/markdown";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  type TypedProperty,
  parseProperties,
  serializeProperties,
  typeNewProperty,
} from "@repo/core/markdown/frontmatter";

import { EDITOR_KIT } from "@renderer/editor/kits/editor-kit";
import { MD_STRINGIFY, parseMarkdown } from "@renderer/editor/markdown/markdown-doc";
import {
  readFrontmatterRaw,
  writeFrontmatterRaw,
} from "@renderer/editor/properties/properties-node";

function seed(md: string) {
  const parsed = parseMarkdown(md);
  if (!parsed.ok) throw new Error("fixture must parse");
  return createSlateEditor({ plugins: EDITOR_KIT, value: parsed.value });
}
function serialize(editor: ReturnType<typeof seed>): string {
  return serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });
}

// The panel's exact edit step: re-type one property, then write it back.
function editProperty(
  editor: ReturnType<typeof seed>,
  mutate: (props: TypedProperty[]) => TypedProperty[],
) {
  const raw = readFrontmatterRaw(editor) ?? "";
  const parsed = parseProperties(raw);
  if (parsed.kind !== "valid") throw new Error(`expected valid, got ${parsed.kind}`);
  writeFrontmatterRaw(editor, serializeProperties(mutate(parsed.properties), raw));
}

const DOC =
  "---\ntitle: Note\ndone: false\ntags:\n  - a\n  - b\nnested:\n  x: 1\n  y: 2\n---\n\n# Body\n\ntext\n";

describe("properties panel edit → serialize", () => {
  it("reads the frontmatter node's raw yaml", () => {
    const editor = seed(DOC);
    expect(readFrontmatterRaw(editor)).toBe(
      "title: Note\ndone: false\ntags:\n  - a\n  - b\nnested:\n  x: 1\n  y: 2",
    );
  });

  it("editing a checkbox flips only that key; the unsupported map is untouched", () => {
    const editor = seed(DOC);
    editProperty(editor, (props) =>
      props.map((p) => (p.key === "done" ? { key: "done", type: "checkbox", value: true } : p)),
    );
    expect(serialize(editor)).toBe(
      "---\ntitle: Note\ndone: true\ntags:\n  - a\n  - b\nnested:\n  x: 1\n  y: 2\n---\n\n# Body\n\ntext\n",
    );
  });

  it("editing a text value serializes the new bytes", () => {
    const editor = seed(DOC);
    editProperty(editor, (props) =>
      props.map((p) => (p.key === "title" ? { key: "title", type: "text", value: "Renamed" } : p)),
    );
    expect(serialize(editor)).toContain("title: Renamed\n");
  });

  it("adding a property to a note with no frontmatter inserts a block", () => {
    const editor = seed("# Body\n\ntext\n");
    expect(readFrontmatterRaw(editor)).toBeNull();
    writeFrontmatterRaw(editor, serializeProperties([typeNewProperty("title", "Hello")], ""));
    const out = serialize(editor);
    expect(out.startsWith("---\ntitle: Hello\n---\n")).toBe(true);
    expect(out).toContain("# Body");
    // The inserted block is itself parseable as a valid property.
    expect(parseProperties(readFrontmatterRaw(editor) ?? "")).toEqual({
      kind: "valid",
      properties: [{ key: "title", type: "text", value: "Hello" }],
    });
  });

  it("clearing every property removes the frontmatter block", () => {
    const editor = seed(DOC);
    writeFrontmatterRaw(editor, serializeProperties([], readFrontmatterRaw(editor) ?? ""));
    const out = serialize(editor);
    expect(out.startsWith("---")).toBe(false);
    expect(out).toContain("# Body");
  });
});

// Tie the byte-pinned round-trip fixtures to the typing layer: the properties-
// rich note types cleanly, the invalid-frontmatter note reports `invalid` (so
// the panel shows "properties unavailable" and never rewrites the block).
const FIXTURES = fileURLToPath(new URL("fixtures/roundtrip/canonical/", import.meta.url));
function fixtureProps(name: string) {
  const text = readFileSync(`${FIXTURES}${name}`, "utf8");
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return parseProperties(match?.[1] ?? "");
}

describe("round-trip fixtures ↔ typing", () => {
  it("frontmatter-properties.md types every supported kind", () => {
    const parsed = fixtureProps("frontmatter-properties.md");
    if (parsed.kind !== "valid") throw new Error("expected valid");
    expect(parsed.properties.map((p) => [p.key, p.type])).toEqual([
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
