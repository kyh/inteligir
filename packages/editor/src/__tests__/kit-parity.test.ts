import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type Descendant, ElementApi, type TElement, createSlateEditor } from "platejs";
import { MarkdownPlugin, serializeMd } from "@platejs/markdown";

import { BASE_KIT } from "@repo/editor/kits/base-kit";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { MD_REMARK_PLUGINS, MD_STRINGIFY } from "@repo/notes/markdown/md-plugins";
import { MD_RULES } from "@repo/editor/markdown/md-rules";
import { parseMarkdown } from "@repo/editor/markdown/markdown-doc";

// Mirror-sync-by-construction: every editor built from the kits carries THE
// shared MarkdownPlugin instance — reference-identical options — and
// serializes the canonical corpus deterministically. The live editor's
// EDITOR_KIT is held to the same contract: it must be a plugin-superset of
// BASE_KIT, share the serialization brain by reference, and agree on
// inline/void node metadata — a missing isInline/isVoid registration would
// let Slate normalization DELETE date/wiki inline voids from a canonical file
// on first edit.

const FIXTURES = fileURLToPath(new URL("fixtures/roundtrip/canonical/", import.meta.url));

// Every node plugin a file's bytes depend on. Dropping any of these from
// BASE_KIT or EDITOR_KIT is a silent corruption hazard, not a cosmetic one —
// the opaque pair most of all, since it is what carries constructs neither
// editor models.
const VOCABULARY_PLUGIN_KEYS = [
  "callout",
  "toggle",
  "column_group",
  "column",
  "video",
  "media_embed",
  "file",
  "date",
  "equation",
  "inline_equation",
  "frontmatter",
  "wikiLink",
  "wikiEmbed",
  "mossFormula",
  "mossCommentMarker",
  "tab_group",
  "tab_panel",
  "opaqueBlock",
  "opaqueInline",
];

function walkElements(nodes: Descendant[], visit: (el: TElement) => void): void {
  for (const node of nodes) {
    if (!ElementApi.isElement(node)) continue;
    visit(node);
    walkElements(node.children, visit);
  }
}

describe("kit parity (Base half)", () => {
  it("BASE_KIT editors share the MarkdownPlugin config by reference", () => {
    const a = createSlateEditor({ plugins: BASE_KIT });
    const b = createSlateEditor({ plugins: BASE_KIT });
    const optionsA = a.getOptions(MarkdownPlugin);
    const optionsB = b.getOptions(MarkdownPlugin);
    expect(optionsA.rules).toBe(MD_RULES);
    expect(optionsB.rules).toBe(MD_RULES);
    expect(optionsA.remarkPlugins).toBe(MD_REMARK_PLUGINS);
    expect(optionsB.remarkPlugins).toBe(MD_REMARK_PLUGINS);
    expect(optionsA.disallowedNodes).toEqual([
      "slash_input",
      "emoji_input",
      "wiki_input",
      "formula_input",
    ]);
  });

  it("serializes the canonical corpus identically across editor instances", () => {
    const a = createSlateEditor({ plugins: BASE_KIT });
    const b = createSlateEditor({ plugins: BASE_KIT });
    for (const name of readdirSync(FIXTURES).toSorted()) {
      const src = readFileSync(`${FIXTURES}${name}`, "utf8");
      const parsed = parseMarkdown(src);
      expect(parsed.ok, `${name} must parse`).toBe(true);
      if (!parsed.ok) continue;
      const outA = serializeMd(a, { remarkStringifyOptions: MD_STRINGIFY, value: parsed.value });
      const outB = serializeMd(b, { remarkStringifyOptions: MD_STRINGIFY, value: parsed.value });
      expect(outA, `${name} must serialize deterministically`).toBe(outB);
      expect(outA.trimEnd(), `${name} must match its canonical bytes`).toBe(src.trimEnd());
    }
  });
});

describe("kit parity (live editor mirror)", () => {
  const base = createSlateEditor({ plugins: BASE_KIT });
  const live = createSlateEditor({ plugins: EDITOR_KIT });

  it("both editors register every vocabulary node plugin", () => {
    for (const key of VOCABULARY_PLUGIN_KEYS) {
      expect(key in base.plugins, `BASE_KIT must register ${key}`).toBe(true);
      expect(key in live.plugins, `EDITOR_KIT must register ${key}`).toBe(true);
    }
  });

  it("EDITOR_KIT is a plugin superset of BASE_KIT", () => {
    const liveKeys = new Set(Object.keys(live.plugins));
    const missing = Object.keys(base.plugins).filter((key) => !liveKeys.has(key));
    expect(missing, "BASE_KIT plugins missing from the live editor").toEqual([]);
  });

  it("the live editor shares the MarkdownPlugin config by reference", () => {
    const options = live.getOptions(MarkdownPlugin);
    expect(options.rules).toBe(MD_RULES);
    expect(options.remarkPlugins).toBe(MD_REMARK_PLUGINS);
    expect(options.disallowedNodes).toEqual([
      "slash_input",
      "emoji_input",
      "wiki_input",
      "formula_input",
    ]);
  });

  it("both editors agree on inline/void metadata for every corpus element", () => {
    for (const name of readdirSync(FIXTURES).toSorted()) {
      const parsed = parseMarkdown(readFileSync(`${FIXTURES}${name}`, "utf8"));
      expect(parsed.ok, `${name} must parse`).toBe(true);
      if (!parsed.ok) continue;
      walkElements(parsed.value, (el) => {
        const tag = `${name}: <${el.type}>`;
        expect(live.api.isInline(el), `${tag} isInline must mirror BASE_KIT`).toBe(
          base.api.isInline(el),
        );
        expect(live.api.isVoid(el), `${tag} isVoid must mirror BASE_KIT`).toBe(base.api.isVoid(el));
      });
    }
  });

  it("registers the inline voids as inline voids (normalization guard)", () => {
    for (const type of ["date", "wikiLink", "wikiEmbed", "inline_equation", "opaqueInline"]) {
      const el: TElement = { children: [{ text: "" }], type };
      for (const [label, editor] of [
        ["BASE_KIT", base],
        ["EDITOR_KIT", live],
      ] as const) {
        expect(editor.api.isInline(el), `${label}: ${type} must be inline`).toBe(true);
        expect(editor.api.isVoid(el), `${label}: ${type} must be void`).toBe(true);
      }
    }
  });

  it("the live editor serializes the canonical corpus to BASE_KIT's bytes", () => {
    for (const name of readdirSync(FIXTURES).toSorted()) {
      const src = readFileSync(`${FIXTURES}${name}`, "utf8");
      const parsed = parseMarkdown(src);
      if (!parsed.ok) continue; // asserted above
      const out = serializeMd(live, { remarkStringifyOptions: MD_STRINGIFY, value: parsed.value });
      expect(out.trimEnd(), `${name} must match its canonical bytes via the live editor`).toBe(
        src.trimEnd(),
      );
    }
  });
});
