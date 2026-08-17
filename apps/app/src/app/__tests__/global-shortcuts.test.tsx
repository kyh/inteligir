// @vitest-environment jsdom

// The palette shortcut belongs to the palette, everywhere — including inside
// the editor. The defect this pins: the editor's keymap ALSO bound it (insert
// link), and because a CodeMirror binding calls preventDefault but never
// stopPropagation, the key reached both — the palette opened AND `[]()` was
// spliced into the note. So the first suite drives the real editor with the
// real listener, and the last is the derived guard that fails when a future
// binding — or a re-vendor of ProseMark — puts one back on a claimed key.
//
// CodeMirror resolves `Mod` and its platform overrides from `navigator` at
// IMPORT time, so the live editor can only be driven on the platform jsdom
// reports — a Ctrl one. That is why the harness holds Ctrl and the mac side
// is covered without a DOM: the guard walks all three platforms, and the pure
// matcher suite pins the other direction (on mac the app claims ⌘ only, so
// mac's emacs Ctrl-K stays the editor's line kill).

import type { MarkdownEditor as MarkdownEditorHandle } from "@repo/editor/create-markdown-editor";
import { markdownEditorKeymap } from "@repo/editor/markdown-editor-extensions";
import { MarkdownEditor } from "@repo/editor/react/markdown-editor";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  GLOBAL_SHORTCUTS,
  globalShortcutFor,
  platformShortcutModifier,
  useGlobalShortcuts,
  type GlobalShortcutAction,
  type ShortcutModifier,
} from "../global-shortcuts";

afterEach(cleanup);

const DOC = "the buffer is the file";
/** Mid-word in "buffer", so a splice is visible wherever it lands. */
const CURSOR = DOC.indexOf("buffer") + 3;

interface Harness {
  editor: MarkdownEditorHandle;
  fired: GlobalShortcutAction[];
}

/** The editor and the window listener, mounted together — the only place the
 *  collision is observable. */
function mountHarness(modifier: ShortcutModifier): Harness {
  const fired: GlobalShortcutAction[] = [];
  let handle: MarkdownEditorHandle | null = null;

  function Harnessed() {
    const [, setPaletteOpen] = useState(false);
    useGlobalShortcuts(modifier, (action) => {
      fired.push(action);
      if (action === "open-palette") {
        setPaletteOpen((open) => !open);
      }
    });
    return (
      <MarkdownEditor
        initialDoc={DOC}
        onEditor={(editor) => {
          handle = editor;
        }}
      />
    );
  }

  render(<Harnessed />);
  if (handle === null) {
    throw new Error("the editor never handed back its handle");
  }
  const editor: MarkdownEditorHandle = handle;
  editor.view.dispatch({ selection: { anchor: CURSOR } });
  editor.focus();
  return { editor, fired };
}

describe("the palette shortcut with the editor focused", () => {
  it("opens the palette and leaves the buffer byte-identical", () => {
    const { editor, fired } = mountHarness("ctrl");

    fireEvent.keyDown(editor.view.contentDOM, { key: "k", code: "KeyK", ctrlKey: true });

    expect(editor.getDoc()).toBe(DOC);
    expect(fired).toEqual(["open-palette"]);
  });

  it("leaves the selection where it was", () => {
    const { editor } = mountHarness("ctrl");

    fireEvent.keyDown(editor.view.contentDOM, { key: "k", code: "KeyK", ctrlKey: true });

    expect(editor.view.state.selection.main.head).toBe(CURSOR);
  });

  it("opens the daily note without the editor consuming it", () => {
    const { editor, fired } = mountHarness("ctrl");

    fireEvent.keyDown(editor.view.contentDOM, { key: "d", code: "KeyD", ctrlKey: true });

    expect(editor.getDoc()).toBe(DOC);
    expect(fired).toEqual(["open-daily-note"]);
  });

  it("still inserts a link on the shifted binding, which reaches no shortcut", () => {
    const { editor, fired } = mountHarness("ctrl");

    // `keyCode` is what CodeMirror falls back to when the shifted `key` ("K")
    // does not match a binding's base ("k") — a real browser always sends it.
    fireEvent.keyDown(editor.view.contentDOM, {
      key: "K",
      code: "KeyK",
      keyCode: 75,
      ctrlKey: true,
      shiftKey: true,
    });

    expect(editor.getDoc()).toBe(`${DOC.slice(0, CURSOR)}[]()${DOC.slice(CURSOR)}`);
    expect(fired).toEqual([]);
  });
});

const keydown = (init: KeyboardEventInit): KeyboardEvent =>
  new KeyboardEvent("keydown", { key: "k", ...init });

describe("the matcher", () => {
  it("claims Ctrl off a non-Apple user agent", () => {
    expect(platformShortcutModifier()).toBe("ctrl");
  });

  it("claims exactly one modifier", () => {
    expect(globalShortcutFor(keydown({ metaKey: true }), "meta")?.action).toBe("open-palette");
    expect(globalShortcutFor(keydown({ ctrlKey: true }), "meta")).toBeNull();
    expect(globalShortcutFor(keydown({ ctrlKey: true }), "ctrl")?.action).toBe("open-palette");
    expect(globalShortcutFor(keydown({ metaKey: true }), "ctrl")).toBeNull();
  });

  it("refuses a combination carrying any other modifier", () => {
    expect(globalShortcutFor(keydown({ metaKey: true, shiftKey: true }), "meta")).toBeNull();
    expect(globalShortcutFor(keydown({ metaKey: true, altKey: true }), "meta")).toBeNull();
    expect(globalShortcutFor(keydown({ metaKey: true, ctrlKey: true }), "meta")).toBeNull();
    expect(globalShortcutFor(keydown({}), "meta")).toBeNull();
  });
});

/**
 * The platforms CodeMirror resolves a binding for, each with the modifier
 * spellings that end up meaning THIS app's shortcut modifier there — "Mod" is
 * Cmd on mac and Ctrl elsewhere, which is why mac's emacs `Ctrl-k` is the
 * editor's to keep and `Mod-k` is not.
 */
const PLATFORMS = [
  { platform: "mac", claimed: ["Mod", "Cmd", "Meta"] },
  { platform: "win", claimed: ["Mod", "Ctrl"] },
  { platform: "linux", claimed: ["Mod", "Ctrl"] },
] as const;

/** The spelling CodeMirror actually installs on `platform` — `buildKeymap`
 *  reads `binding[platform] || binding.key`, so a platform override REPLACES
 *  the generic key rather than adding to it. */
function liveSpelling(
  binding: (typeof markdownEditorKeymap)[number],
  platform: "mac" | "win" | "linux",
): string | undefined {
  return binding[platform] ?? binding.key;
}

/** True when `spelling` is the app's modifier plus `letter` and nothing else —
 *  the exact shape `globalShortcutFor` claims. */
function claimsLetter(spelling: string, letter: string, claimed: readonly string[]): boolean {
  const parts = spelling.split("-");
  const base = parts.at(-1);
  if (base === undefined || base.toLowerCase() !== letter) {
    return false;
  }
  const modifiers = parts.slice(0, -1);
  return modifiers.length > 0 && modifiers.every((modifier) => claimed.includes(modifier));
}

describe("the two keymaps do not overlap", () => {
  it("binds no app shortcut inside the editor's keymap, on any platform", () => {
    const collisions = PLATFORMS.flatMap(({ platform, claimed }) =>
      GLOBAL_SHORTCUTS.flatMap((shortcut) =>
        markdownEditorKeymap
          .map((binding) => liveSpelling(binding, platform))
          .filter(
            (spelling): spelling is string =>
              spelling !== undefined && claimsLetter(spelling, shortcut.key, claimed),
          )
          .map((spelling) => `${platform}: ${spelling} vs ${shortcut.label}`),
      ),
    );

    expect(
      collisions,
      "A CodeMirror binding calls preventDefault but never stopPropagation, so a key in " +
        "BOTH tables runs both handlers — the app's action AND the editor's edit. Either " +
        "drop the binding from packages/editor/src/markdown-editor-extensions.ts " +
        "(markdownEditorKeymap) or drop the shortcut from " +
        "apps/app/src/app/global-shortcuts.ts. Overlapping: " +
        collisions.join(", "),
    ).toEqual([]);
  });
});
