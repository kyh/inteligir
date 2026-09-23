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

// rows whose fresh insert is not yet its own fixpoint, each with why; a row here is asserted to
// still churn, so the entry fails the day the defect is fixed and cannot outlive it.
const NOT_YET_CANONICAL = new Map<string, string>([
  [
    "inline-equation",
    "an empty inline equation serializes as `$$$$`, which re-parses as text and saves escaped",
  ],
]);

const OPAQUE_TYPES = new Set(["opaqueBlock", "opaqueInline"]);

const opaqueTypesIn = (nodes: readonly Descendant[]): string[] =>
  nodes.flatMap((node) => {
    if (!ElementApi.isElement(node)) {
      return [];
    }
    return OPAQUE_TYPES.has(node.type) ? [node.type] : opaqueTypesIn(node.children);
  });

const startValue = (): Value => [{ children: [{ text: "x" }], type: "p" }];

describe("every slash row inserts a modeled construct", () => {
  for (const { group, items } of GROUPS) {
    for (const item of items) {
      it(`${group} › ${item.label}`, () => {
        const editor = createPlateEditor({ plugins: EDITOR_KIT, value: startValue() });
        editor.tf.select(editor.api.end([0]));
        item.onSelect(editor);
        const md = serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });

        const parsed = parseMarkdown(md);
        expect(parsed.ok, md).toBe(true);
        expect(parsed.ok ? opaqueTypesIn(parsed.value) : [], md).toEqual([]);
        if (NOT_YET_CANONICAL.has(item.value)) {
          expect(roundTrip(md), NOT_YET_CANONICAL.get(item.value)).not.toBe(md);
        } else {
          expect(roundTrip(md), md).toBe(md);
        }
      });
    }
  }

  it("names no row the menu does not have", () => {
    const values = new Set(GROUPS.flatMap(({ items }) => items.map((item) => item.value)));
    expect([...NOT_YET_CANONICAL.keys()].filter((value) => !values.has(value))).toEqual([]);
  });
});
