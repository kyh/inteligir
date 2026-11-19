import { describe, expect, it } from "vitest";
import { DOM_HANDLERS, createPlateEditor, pipeHandler } from "platejs/react";
import type { AnyEditorPlatePlugin } from "platejs/react";
import type { TRange, Value } from "platejs";

import { PROFILE_KITS } from "@repo/editor/kits/profile-kits";

const LIVE_READ_ONLY = {
  eventEditor: "notes which editor has focus",
  findBar: "opens the find bar and steps to a match; the bar offers no replace read-only",
  table: "carries a selection across cells",
} satisfies Record<string, string>;

const editOnlyFor = (plugin: AnyEditorPlatePlugin, feature: "handlers" | "render") => {
  const { editOnly } = plugin;

  if (editOnly === undefined || editOnly === false) {
    return false satisfies boolean;
  }

  return (editOnly === true || editOnly[feature] !== false) satisfies boolean;
};

const hasDomHandlers = (plugin: AnyEditorPlatePlugin) =>
  DOM_HANDLERS.some((key) => (plugin.handlers[key] ?? null) !== null) satisfies boolean;

const KITS = Object.entries(PROFILE_KITS);

const pluginsOf = (kit: (typeof KITS)[number][1]) => {
  const plugins: AnyEditorPlatePlugin[] = createPlateEditor({ plugins: kit }).meta.pluginList;

  return plugins;
};

const liveKeys = (kit: (typeof KITS)[number][1]) =>
  pluginsOf(kit)
    .filter((plugin) => hasDomHandlers(plugin) && !editOnlyFor(plugin, "handlers"))
    .map((plugin) => plugin.key) satisfies string[];

describe("a read-only editor's DOM handlers", () => {
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

const CHORDS_THAT_TRANSFORM = ["bold.toggle", "italic.toggle", "underline.toggle"];

describe("a read-only editor's chords", () => {
  it.each(KITS)("in the %s kit are only chords the model refuses", (_profile, kit) => {
    expect(
      Object.keys(createPlateEditor({ plugins: kit }).meta.shortcuts).toSorted(),
      "a chord no editOnly gates: name it in CHORDS_THAT_TRANSFORM once it only transforms, or gate its handler on editor.dom.readOnly",
    ).toStrictEqual(CHORDS_THAT_TRANSFORM);
  });
});

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

const caretAt = (path: number[], offset: number) =>
  ({
    anchor: { offset, path },
    focus: { offset, path },
  }) satisfies TRange;

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
  const press = ({ at, event, value }: (typeof KEYS_THAT_WRITE)[number], readOnly: boolean) => {
    const editor = createPlateEditor({ plugins: kit, value });
    editor.tf.select(at);
    editor.dom.readOnly = readOnly;
    const before = editor.children;
    pipeHandler(editor, { handlerKey: "onKeyDown" })?.(event);

    return (editor.children !== before) satisfies boolean;
  };

  it.each(KEYS_THAT_WRITE)("$name writes while editable and nothing read-only", (key) => {
    expect(press(key, false)).toBe(true);
    expect(press(key, true)).toBe(false);
  });
});

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
