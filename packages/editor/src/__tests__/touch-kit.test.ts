import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ElementApi, createSlateEditor } from "platejs";
import type { Descendant, SlateEditor, TElement } from "platejs";

import { DragKit } from "@repo/editor/block-draggable";
import { CommentGutterKit } from "@repo/editor/comments/comment-gutter";
import { FindBarKit } from "@repo/editor/find-bar";
import { BASE_KIT } from "@repo/editor/kits/base-kit";
import { BlockMenuKit } from "@repo/editor/kits/block-menu-kit";
import { CONTENT_KIT, DESKTOP_CHROME_KIT, EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { FloatingToolbarKit } from "@repo/editor/kits/floating-toolbar-kit";
import { RichBlockLockKit } from "@repo/editor/kits/rich-block-lock-kit";
import { TOUCH_EDITOR_KIT } from "@repo/editor/kits/touch-editor-kit";
import { parseMarkdown, serializeNote } from "@repo/editor/markdown/markdown-doc";
import { TouchToolbarKit } from "@repo/editor/touch-toolbar";

const FIXTURES = fileURLToPath(new URL("fixtures/roundtrip/canonical/", import.meta.url));

// what a kit registers once Plate has resolved it (nested plugins included), core plugins aside
const CORE_KEYS = new Set(Object.keys(createSlateEditor().plugins));
const keysOf = (editor: SlateEditor): string[] =>
  Object.keys(editor.plugins).filter((key) => !CORE_KEYS.has(key));

const walkElements = (nodes: Descendant[], visit: (el: TElement) => void): void => {
  for (const node of nodes) {
    if (!ElementApi.isElement(node)) {
      continue;
    }
    visit(node);
    walkElements(node.children, visit);
  }
};

const kitKeys = {
  content: keysOf(createSlateEditor({ plugins: CONTENT_KIT })),
  desktop: keysOf(createSlateEditor({ plugins: EDITOR_KIT })),
  desktopChrome: keysOf(createSlateEditor({ plugins: DESKTOP_CHROME_KIT })),
  pointerChrome: keysOf(
    createSlateEditor({
      plugins: [
        ...CommentGutterKit,
        ...FindBarKit,
        ...DragKit,
        ...BlockMenuKit,
        ...FloatingToolbarKit,
      ],
    }),
  ),
  touch: keysOf(createSlateEditor({ plugins: TOUCH_EDITOR_KIT })),
  touchChrome: keysOf(createSlateEditor({ plugins: [...RichBlockLockKit, ...TouchToolbarKit] })),
};

describe("the touch kit", () => {
  const base = createSlateEditor({ plugins: BASE_KIT });
  const touch = createSlateEditor({ plugins: TOUCH_EDITOR_KIT });

  it("registers every plugin BASE_KIT does, so nothing it opens is lost on save", () => {
    const touchKeys = new Set(Object.keys(touch.plugins));
    const missing = Object.keys(base.plugins).filter((key) => !touchKeys.has(key));
    expect(missing, "BASE_KIT plugins missing from TOUCH_EDITOR_KIT").toEqual([]);
  });

  it("serializes the canonical corpus to its canonical bytes", () => {
    for (const name of readdirSync(FIXTURES).toSorted()) {
      const src = readFileSync(`${FIXTURES}${name}`, "utf-8");
      const parsed = parseMarkdown(src);
      expect(parsed.ok, `${name} must parse`).toBe(true);
      if (!parsed.ok) {
        continue;
      }
      expect(serializeNote(touch, parsed.value).trimEnd(), name).toBe(src.trimEnd());
    }
  });

  it("agrees with BASE_KIT on inline/void metadata for every corpus element", () => {
    for (const name of readdirSync(FIXTURES).toSorted()) {
      const parsed = parseMarkdown(readFileSync(`${FIXTURES}${name}`, "utf-8"));
      if (!parsed.ok) {
        continue;
      }
      walkElements(parsed.value, (el) => {
        const tag = `${name}: <${el.type}>`;
        expect(touch.api.isInline(el), `${tag} isInline`).toBe(base.api.isInline(el));
        expect(touch.api.isVoid(el), `${tag} isVoid`).toBe(base.api.isVoid(el));
      });
    }
  });
});

describe("EDITOR_KIT after the content/chrome split", () => {
  it("is CONTENT_KIT then DESKTOP_CHROME_KIT, and no plugin sits in both halves", () => {
    expect(kitKeys.desktop).toEqual([...kitKeys.content, ...kitKeys.desktopChrome]);
    const content = new Set(kitKeys.content);
    expect(kitKeys.desktopChrome.filter((key) => content.has(key))).toEqual([]);
  });

  // the two kits are composed apart, so this is what says neither dropped a plugin the other kept
  it("differs from the touch kit by exactly the pointer chrome and the touch chrome", () => {
    const desktop = new Set(kitKeys.desktop);
    const touch = new Set(kitKeys.touch);
    expect(
      kitKeys.desktop.filter((key) => !touch.has(key)).toSorted(),
      "desktop-only plugins",
    ).toEqual(kitKeys.pointerChrome.toSorted());
    expect(
      kitKeys.touch.filter((key) => !desktop.has(key)).toSorted(),
      "touch-only plugins",
    ).toEqual(kitKeys.touchChrome.toSorted());
  });
});
