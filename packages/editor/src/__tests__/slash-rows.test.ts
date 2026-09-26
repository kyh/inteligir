// a row whose bytes re-parse as an opaque node inserts something the editor can no longer edit:
// the next open draws it as a raw island.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ElementApi } from "platejs";
import type { Descendant, Value } from "platejs";
import { createPlateEditor } from "platejs/react";

import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { parseMarkdown, roundTrip, serializeNote } from "@repo/editor/markdown/markdown-doc";
import { GROUPS } from "@repo/editor/slash-menu";
import type { SlashItem } from "@repo/editor/slash-menu";

const OPAQUE_TYPES = new Set(["opaqueBlock", "opaqueInline"]);

const opaqueTypesIn = (nodes: readonly Descendant[]): string[] =>
  nodes.flatMap((node) => {
    if (!ElementApi.isElement(node)) {
      return [];
    }
    return OPAQUE_TYPES.has(node.type) ? [node.type] : opaqueTypesIn(node.children);
  });

// the menu opens after text and on an empty line, and a row's bytes may differ between the two.
const START_LINES = new Map<string, string>([
  ["after text", "x"],
  ["on an empty line", ""],
]);

const editorAt = (text: string) => {
  const value: Value = [{ children: [{ text }], type: "p" }];
  const editor = createPlateEditor({ plugins: EDITOR_KIT, value });
  editor.tf.select(editor.api.end([0]));
  return editor;
};

const writtenBy = (item: SlashItem, text: string): string => {
  const editor = editorAt(text);
  item.onSelect(editor);
  return serializeNote(editor);
};

describe("every slash row inserts a modeled construct", () => {
  for (const [where, text] of START_LINES) {
    for (const { group, items } of GROUPS) {
      for (const item of items) {
        it(`${group} › ${item.label}, ${where}`, () => {
          const md = writtenBy(item, text);

          const parsed = parseMarkdown(md);
          expect(parsed.ok, md).toBe(true);
          expect(parsed.ok ? opaqueTypesIn(parsed.value) : [], md).toEqual([]);
          expect(roundTrip(md), md).toBe(md);
        });
      }
    }
  }
});

// two rows writing the same bytes are one construct under two names: the second name belongs in
// the first row's keywords.
describe("no two slash rows write the same bytes", () => {
  // mid-month, since on the first Date and Month rightly agree
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(2026, 8, 15), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  for (const [where, text] of START_LINES) {
    it(where, () => {
      const untouched = serializeNote(editorAt(text));
      const rowsByBytes = new Map<string, string[]>();
      for (const { group, items } of GROUPS) {
        for (const item of items) {
          const md = writtenBy(item, text);
          // wrote nothing, so shares nothing: Text on a paragraph, Embed's url dialog, an inline
          // equation before it holds TeX
          if (md === untouched) {
            continue;
          }
          rowsByBytes.set(md, [...(rowsByBytes.get(md) ?? []), `${group} › ${item.label}`]);
        }
      }
      const shared = [...rowsByBytes.values()].filter((rows) => rows.length > 1);
      expect(shared, `rows that write identical markdown ${where}`).toEqual([]);
    });
  }
});
