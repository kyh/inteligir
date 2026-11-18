import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ElementApi } from "platejs";
import type { Descendant, Value } from "platejs";
import { createPlateEditor } from "platejs/react";

import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { lockedBlockTypes } from "@repo/editor/kits/rich-block-lock-kit";
import { parseMarkdown, serializeNote } from "@repo/editor/headless/markdown/markdown-doc";
import { rewrite } from "@repo/editor/test-support/markdown-meaning.test-utils";
import { GROUPS } from "@repo/editor/slash-items";
import type { SlashItem } from "@repo/editor/slash-items";

const typesIn: (nodes: readonly Descendant[], wanted: ReadonlySet<string>) => string[] = (
  nodes: readonly Descendant[],
  wanted: ReadonlySet<string>,
) =>
  nodes.flatMap((node) => {
    if (!ElementApi.isElement(node)) {
      return [];
    }

    return wanted.has(node.type) ? [node.type] : typesIn(node.children, wanted);
  });

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

const writtenBy = (item: SlashItem, text: string) => {
  const editor = editorAt(text);
  item.onSelect(editor);

  return serializeNote(editor);
};

const ROWS = GROUPS.flatMap(({ group, items }) =>
  items.map((item) => ({ item, row: `${group} › ${item.label}` })),
);

describe("every slash row inserts a modeled construct", () => {
  it.each(
    [...START_LINES].flatMap(([where, text]) => ROWS.map((row) => ({ ...row, text, where }))),
  )("$row, $where", ({ item, text }) => {
    const md = writtenBy(item, text);

    const parsed = parseMarkdown(md);
    expect(parsed.ok, md).toBe(true);
    expect(md).not.toMatch(/\\:|\\\[\\\[/u);
    expect(rewrite(md), md).toBe(md);
  });
});

describe("a row is a rich block exactly when it inserts a block the lock holds", () => {
  it.each(ROWS)("$row", ({ item }) => {
    const editor = editorAt("");
    item.onSelect(editor);
    const locked = typesIn(editor.children, lockedBlockTypes(editor));
    expect(item.richBlock === true, item.label).toBe(locked.length > 0);
  });
});

describe("no two slash rows write the same bytes", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(2026, 8, 15), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([...START_LINES])("%s", (where, text) => {
    const untouched = serializeNote(editorAt(text));
    const rowsByBytes = new Map<string, string[]>();

    for (const { group, items } of GROUPS) {
      for (const item of items) {
        const md = writtenBy(item, text);

        if (md === untouched) {
          continue;
        }

        rowsByBytes.set(md, [...(rowsByBytes.get(md) ?? []), `${group} › ${item.label}`]);
      }
    }

    const shared = [...rowsByBytes.values()].filter((rows) => rows.length > 1);
    expect(shared, `rows that write identical markdown ${where}`).toStrictEqual([]);
  });
});
