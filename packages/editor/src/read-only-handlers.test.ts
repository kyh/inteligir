// slate-react hands every DOM event of a read-only editor to Plate's handler pipe, which skips a
// plugin only when its editOnly keeps its handlers for an editable editor. So with no connection a
// paste, a drop or a key reaches every other plugin, and one that writes would edit an item the
// cloud cannot take. A handler that slips through still writes nothing: the model refuses the op.
// `tools/e2e/src/saved-note.spec.ts` presses these keys and the chords in a browser.

import { describe, expect, it } from "vitest";
import { DOM_HANDLERS, createPlateEditor, pipeHandler } from "platejs/react";
import type { AnyEditorPlatePlugin } from "platejs/react";
import type { TRange, Value } from "platejs";

import { PROFILE_KITS } from "@repo/editor/kits/profile-kits";

// each runs read-only, so each says why it writes nothing
const LIVE_READ_ONLY = {
  eventEditor: "notes which editor has focus",
  findBar: "opens the find bar and steps to a match; the bar offers no replace read-only",
  table: "carries a selection across cells",
} satisfies Record<string, string>;

// Plate's own reading: `true` or an object keeps a feature edit-only unless it says `false` for it
const editOnlyFor = (plugin: AnyEditorPlatePlugin, feature: "handlers" | "render"): boolean => {
  const { editOnly } = plugin;
  if (editOnly === undefined || editOnly === false) {
    return false;
  }
  return editOnly === true || editOnly[feature] !== false;
};

const hasDomHandlers = (plugin: AnyEditorPlatePlugin): boolean =>
  DOM_HANDLERS.some((key) => (plugin.handlers[key] ?? null) !== null);

const KITS = Object.entries(PROFILE_KITS);

const pluginsOf = (kit: (typeof KITS)[number][1]): AnyEditorPlatePlugin[] =>
  createPlateEditor({ plugins: kit }).meta.pluginList;

const liveKeys = (kit: (typeof KITS)[number][1]): string[] =>
  pluginsOf(kit)
    .filter((plugin) => hasDomHandlers(plugin) && !editOnlyFor(plugin, "handlers"))
    .map((plugin) => plugin.key);

describe("a read-only editor's DOM handlers", () => {
  // Plate's editOnly gates a node's drawing with its handlers unless it says otherwise
  it.each(KITS)("are kept from no node of the %s kit's drawing", (_profile, kit) => {
    expect(
      pluginsOf(kit)
        .filter(
          (plugin) =>
            (plugin.node.component ?? null) !== null &&
            hasDomHandlers(plugin) &&
            editOnlyFor(plugin, "render"),
        )
        .map((plugin) => plugin.key),
    ).toStrictEqual([]);
  });

  it.each(KITS)("run in the %s kit only where they write nothing", (_profile, kit) => {
    expect(
      liveKeys(kit).filter((key) => !Object.hasOwn(LIVE_READ_ONLY, key)),
      "these plugins run a DOM handler in a read-only editor: make each editOnly, or name it in LIVE_READ_ONLY with why it writes nothing",
    ).toStrictEqual([]);
  });

  it("are named in LIVE_READ_ONLY only while one runs read-only", () => {
    const live = new Set(KITS.flatMap(([, kit]) => liveKeys(kit)));
    expect(Object.keys(LIVE_READ_ONLY).filter((key) => !live.has(key))).toStrictEqual([]);
  });
});

// Plate binds a plugin's `shortcuts` through its hotkeys effect, outside the handler pipe, so no
// editOnly gates a chord, and one fires read-only from a link holding the focus. Their gate is the
// model's (`edit-guard.ts`): each of these only transforms, so each writes nothing read-only.
const CHORDS_THAT_TRANSFORM = [
  "bold.toggle",
  "italic.toggle",
  "p.toggleParagraph",
  "underline.toggle",
];

describe("a read-only editor's chords", () => {
  it.each(KITS)("in the %s kit are only chords the model refuses", (_profile, kit) => {
    expect(
      Object.keys(createPlateEditor({ plugins: kit }).meta.shortcuts).toSorted(),
      "a chord no editOnly gates: name it in CHORDS_THAT_TRANSFORM once it only transforms, or gate its handler on editor.dom.readOnly",
    ).toStrictEqual(CHORDS_THAT_TRANSFORM);
  });
});

// is-hotkey matches on `which`, and resolves "mod" to ctrl where node shows no Mac platform
const keydown = (key: string, which: number, modifiers: { ctrl?: boolean } = {}) => ({
  altKey: false,
  ctrlKey: modifiers.ctrl === true,
  defaultPrevented: false,
  isDefaultPrevented: () => false,
  isPropagationStopped: () => false,
  key,
  keyCode: which,
  metaKey: false,
  nativeEvent: { isComposing: false, keyCode: which },
  persist: () => {},
  preventDefault: () => {},
  shiftKey: false,
  stopPropagation: () => {},
  which,
});

const caretAt = (path: number[], offset: number): TRange => ({
  anchor: { offset, path },
  focus: { offset, path },
});

const VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

const KEYS_THAT_WRITE: {
  name: string;
  value: Value;
  at: TRange;
  event: ReturnType<typeof keydown>;
}[] = [
  {
    at: caretAt([0, 0, 0], 0),
    event: keydown("Tab", 9),
    name: "Tab in a code line",
    value: [{ children: [{ children: [{ text: "x" }], type: "code_line" }], type: "code_block" }],
  },
  {
    at: caretAt([0, 0], 0),
    event: keydown("Tab", 9),
    name: "Tab in a list item",
    value: [{ children: [{ text: "item" }], indent: 1, listStyleType: "disc", type: "p" }],
  },
  {
    at: caretAt([0, 0], VIDEO_URL.length),
    event: keydown("Enter", 13),
    name: "Enter after a video's url",
    value: [{ children: [{ text: VIDEO_URL }], type: "p" }],
  },
  {
    at: caretAt([0, 0], 0),
    event: keydown("l", 76, { ctrl: true }),
    name: "the bulleted list's chord",
    value: [{ children: [{ text: "line" }], type: "p" }],
  },
];

describe.each(KITS)("a key in the %s kit", (_profile, kit) => {
  const press = (
    { at, event, value }: (typeof KEYS_THAT_WRITE)[number],
    readOnly: boolean,
  ): boolean => {
    const editor = createPlateEditor({ plugins: kit, value });
    editor.tf.select(at);
    editor.dom.readOnly = readOnly;
    const before = editor.children;
    pipeHandler(editor, { handlerKey: "onKeyDown" })?.(event);
    return editor.children !== before;
  };

  it.each(KEYS_THAT_WRITE)("$name writes while editable and nothing read-only", (key) => {
    expect(press(key, false)).toBe(true);
    expect(press(key, true)).toBe(false);
  });
});

// a node's own button writes through a transform, which Plate's readOnly never gates
describe.each(KITS)("a transform in the %s kit", (_profile, kit) => {
  it("writes nothing read-only, where the caret still moves", () => {
    const editor = createPlateEditor({
      plugins: kit,
      value: [{ children: [{ text: "line" }], type: "p" }],
    });
    editor.dom.readOnly = true;
    const before = editor.children;

    editor.tf.setNodes({ type: "h1" }, { at: [0] });
    editor.tf.insertText("typed", { at: { offset: 0, path: [0, 0] } });
    editor.tf.insertNodes({ children: [{ text: "more" }], type: "p" }, { at: [1] });
    editor.tf.select(caretAt([0, 0], 2));

    expect(editor.children).toBe(before);
    expect(editor.selection).toStrictEqual(caretAt([0, 0], 2));

    editor.dom.readOnly = false;
    editor.tf.setNodes({ type: "h1" }, { at: [0] });
    expect(editor.children).toMatchObject([{ type: "h1" }]);
  });
});
