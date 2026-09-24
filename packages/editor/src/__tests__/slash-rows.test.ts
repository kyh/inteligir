// a row whose bytes re-parse as an opaque node inserts something the editor can no longer edit:
// the next open draws it as a raw island.

import { describe, expect, it } from "vitest";
import { ElementApi } from "platejs";
import type { Descendant, Value } from "platejs";
import { createPlateEditor } from "platejs/react";
import { serializeMd } from "@platejs/markdown";

import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { MD_STRINGIFY, parseMarkdown, roundTrip } from "@repo/editor/markdown/markdown-doc";
import { GROUPS } from "@repo/editor/slash-menu";

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

describe("every slash row inserts a modeled construct", () => {
  for (const [where, text] of START_LINES) {
    for (const { group, items } of GROUPS) {
      for (const item of items) {
        it(`${group} › ${item.label}, ${where}`, () => {
          const value: Value = [{ children: [{ text }], type: "p" }];
          const editor = createPlateEditor({ plugins: EDITOR_KIT, value });
          editor.tf.select(editor.api.end([0]));
          item.onSelect(editor);
          const md = serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });

          const parsed = parseMarkdown(md);
          expect(parsed.ok, md).toBe(true);
          expect(parsed.ok ? opaqueTypesIn(parsed.value) : [], md).toEqual([]);
          expect(roundTrip(md), md).toBe(md);
        });
      }
    }
  }
});
