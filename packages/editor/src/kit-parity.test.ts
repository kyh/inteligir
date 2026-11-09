import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ElementApi, KEYS, createSlateEditor } from "platejs";
import type { AnyPluginConfig, Descendant, SlateEditor, TElement } from "platejs";
import { MarkdownPlugin, defaultRules } from "@platejs/markdown";
import { z } from "zod";

import { PICKER_INPUT_TYPES } from "@repo/editor/combobox-input";
import * as DIALECT_NODE_KEYS from "@repo/editor/dialect-node-keys";
import { BASE_KIT } from "@repo/editor/kits/base-kit";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { TOUCH_EDITOR_KIT } from "@repo/editor/kits/touch-editor-kit";
import { blockOfElement } from "@repo/editor/live/note-blocks";
import { MD_REMARK_PLUGINS } from "@repo/editor/markdown/md-plugins";
import { MD_RULES } from "@repo/editor/markdown/md-rules";
import { parseMarkdown, serializeNote } from "@repo/editor/markdown/markdown-doc";
import { readValue, rewrite } from "@repo/editor/test-support/markdown-meaning";

const FIXTURES = fileURLToPath(new URL("test-support/fixtures/corpus/", import.meta.url));

// dropping any of these from a kit is silent corruption. Every dialect key is in by construction;
// Plate's own nodes the dialect spells are named here.
const VOCABULARY_PLUGIN_KEYS = [
  KEYS.column,
  KEYS.columnGroup,
  KEYS.date,
  KEYS.equation,
  KEYS.file,
  KEYS.inlineEquation,
  KEYS.mediaEmbed,
  KEYS.mention,
  KEYS.toggle,
  KEYS.underline,
  KEYS.video,
  ...Object.values(DIALECT_NODE_KEYS),
];

const walkElements = (nodes: Descendant[], visit: (el: TElement) => void): void => {
  for (const node of nodes) {
    if (!ElementApi.isElement(node)) {
      continue;
    }
    visit(node);
    walkElements(node.children, visit);
  }
};

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
  });

  it("serializes the corpus identically across editor instances, each write its own fixpoint", () => {
    const a = createSlateEditor({ plugins: BASE_KIT });
    const b = createSlateEditor({ plugins: BASE_KIT });
    for (const name of readdirSync(FIXTURES).toSorted()) {
      const src = readFileSync(`${FIXTURES}${name}`, "utf-8");
      const parsed = parseMarkdown(src);
      expect(parsed.ok, `${name} must parse`).toBe(true);
      if (!parsed.ok) {
        continue;
      }
      const outA = serializeNote(a, parsed.value);
      const outB = serializeNote(b, parsed.value);
      expect(outA, `${name} must serialize deterministically`).toBe(outB);
      expect(rewrite(outA), `${name} must write its own fixpoint`).toBe(outA);
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
    expect(missing, "BASE_KIT plugins missing from the live editor").toStrictEqual([]);
  });

  it("the live editor shares the MarkdownPlugin config by reference", () => {
    const options = live.getOptions(MarkdownPlugin);
    expect(options.rules).toBe(MD_RULES);
    expect(options.remarkPlugins).toBe(MD_REMARK_PLUGINS);
  });

  it("both editors agree on inline/void metadata for every corpus element", () => {
    for (const name of readdirSync(FIXTURES).toSorted()) {
      const parsed = parseMarkdown(readFileSync(`${FIXTURES}${name}`, "utf-8"));
      expect(parsed.ok, `${name} must parse`).toBe(true);
      if (!parsed.ok) {
        continue;
      }
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
    for (const type of [
      KEYS.date,
      KEYS.mention,
      KEYS.inlineEquation,
      DIALECT_NODE_KEYS.FORMULA_PILL_KEY,
    ]) {
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

  // the grammar reads no jsx and the serializer has no handler for one, so a node reaching a Plate
  // default that answers jsx would throw the save
  it("answers every node either editor can hold with a rule that writes no jsx", () => {
    const answered = z.object({ type: z.string() });
    const jsx: string[] = [];
    const plain = new Set(live.getOptions(MarkdownPlugin).plainMarks);
    for (const [key, fallback] of Object.entries(defaultRules)) {
      const rule = MD_RULES[key] ?? fallback;
      if (
        !(key in live.plugins) ||
        plain.has(key) ||
        rule.serialize === undefined ||
        rule.serialize === null
      ) {
        continue;
      }
      const node =
        rule.mark === true ? { [key]: true, text: "x" } : { children: [{ text: "" }], type: key };
      const written = answered.safeParse(rule.serialize(node, { editor: live }));
      if (written.success && written.data.type.startsWith("mdxJsx")) {
        jsx.push(key);
      }
    }
    expect(jsx).toStrictEqual([]);
  });

  it("the live editor serializes the corpus to BASE_KIT's bytes", () => {
    for (const name of readdirSync(FIXTURES).toSorted()) {
      const src = readFileSync(`${FIXTURES}${name}`, "utf-8");
      const parsed = parseMarkdown(src);
      if (!parsed.ok) {
        continue;
      }
      expect(serializeNote(live, parsed.value), `${name} must write alike in both editors`).toBe(
        serializeNote(base, parsed.value),
      );
    }
  });
});

const editorOf = (
  plugins: readonly AnyPluginConfig[],
  value: readonly TElement[] = [],
): SlateEditor => createSlateEditor({ plugins: [...plugins], value: structuredClone([...value]) });

const pluginNode = z.object({
  node: z.object({
    isElement: z.boolean().optional(),
    isInline: z.boolean().optional(),
    isMarkableVoid: z.boolean().optional(),
    isVoid: z.boolean().optional(),
    type: z.string(),
  }),
});

// each element type with how Slate holds it
const schemaOf = (plugins: readonly AnyPluginConfig[]): string[] =>
  Object.values(editorOf(plugins).plugins)
    .flatMap((plugin) => {
      const { node } = pluginNode.parse(plugin);
      return node.isElement === true
        ? [
            [
              node.type,
              node.isInline === true ? "inline" : "block",
              node.isVoid === true ? "void" : "",
              node.isMarkableVoid === true ? "markable" : "",
            ].join(" "),
          ]
        : [];
    })
    .toSorted();

const normalized = (plugins: readonly AnyPluginConfig[], value: readonly TElement[]) => {
  const editor = editorOf(plugins, value);
  editor.tf.normalize({ force: true });
  return editor.children;
};

// Every editor of a note, the note's own headless one included, edits one live document: each
// must read a node as the others do and write the same fix for the same state, or a reader fixes
// what its writer left and two readers fix it twice.
describe("kit parity (one live document)", () => {
  const KITS = { desktop: EDITOR_KIT, touch: TOUCH_EDITOR_KIT };

  const corpus = readdirSync(FIXTURES)
    .toSorted()
    .map((name) => ({ name, value: readValue(readFileSync(`${FIXTURES}${name}`, "utf-8")) }));

  // what an editor is handed besides a file as read: blocks as the library stores them, which drop
  // the empty texts Slate keeps beside an inline, a toggle typed into, and a picker left open
  const handed: { name: string; value: TElement[] }[] = [
    ...corpus,
    ...corpus.map(({ name, value }) => ({
      name: `${name} as stored`,
      value: value.flatMap((element, index) => {
        const block = blockOfElement({ ...element, id: `b${String(index)}` });
        return block === null ? [] : [block];
      }),
    })),
    { name: "a toggle typed into", value: [{ children: [{ text: "typed" }], type: KEYS.toggle }] },
    {
      name: "a picker open in a line",
      value: PICKER_INPUT_TYPES.map((type) => ({
        children: [{ text: "a" }, { children: [{ text: "q" }], type }, { text: "b" }],
        type: KEYS.p,
      })),
    },
  ];

  it.each(Object.entries(KITS))("the %s kit holds every element as BASE_KIT does", (_, kit) => {
    expect(schemaOf(kit)).toStrictEqual(schemaOf(BASE_KIT));
  });

  it.each(Object.entries(KITS))(
    "the %s kit normalizes what it is handed as BASE_KIT does",
    (_, kit) => {
      for (const { name, value } of handed) {
        expect(normalized(kit, value), name).toStrictEqual(normalized(BASE_KIT, value));
      }
    },
  );
});
