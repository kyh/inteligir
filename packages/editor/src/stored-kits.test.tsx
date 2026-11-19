import { fireEvent, render } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AnyPluginConfig } from "platejs";
import { createSlateEditor } from "platejs";
import { Plate, PlateContent, createPlateEditor } from "platejs/react";
import type { PlateEditor } from "platejs/react";

import type { BodyBlock } from "@repo/contract/library/derive-item";

import { blocksOfValue, editorValueOf } from "@repo/editor/headless/body/note-blocks";
import { pillEntries } from "@repo/editor/headless/formulas/pill-nodes";
import { BASE_KIT } from "@repo/editor/headless/kits/base-kit";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { TOUCH_EDITOR_KIT } from "@repo/editor/kits/touch-editor-kit";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host.test-utils";

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "isContentEditable", {
    configurable: true,
    get(this: HTMLElement) {
      return this.closest('[contenteditable="true"]') !== null;
    },
  });
});

beforeEach(() => {
  installFakeEditorHost();
});

afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "isContentEditable");
});

const KITS: [string, readonly AnyPluginConfig[]][] = [
  ["desktop", EDITOR_KIT],
  ["touch", TOUCH_EDITOR_KIT],
];

const SEEDED: BodyBlock[] = [
  { block: { children: [{ text: "hello" }], id: "one", type: "p" }, section: "note" },
  {
    block: {
      children: [
        { text: "sum " },
        { children: [{ text: "" }], display: "?", source: "1 + 2", type: "formulaPill" },
      ],
      id: "sum",
      type: "p",
    },
    section: "note",
  },
];

const reopened = (blocks: readonly BodyBlock[]) =>
  blocksOfValue(
    createSlateEditor({ nodeId: true, plugins: BASE_KIT, value: editorValueOf(blocks) }).children,
  );

const mounted = (kit: readonly AnyPluginConfig[]) => {
  const device: PlateEditor = createPlateEditor({
    nodeId: true,
    plugins: [...kit],
    value: editorValueOf(SEEDED),
  });

  const view = render(
    <Plate editor={device}>
      <PlateContent />
    </Plate>,
  );

  const editable = view.container.querySelector("[data-slate-editor]");

  if (!(editable instanceof HTMLElement)) {
    throw new TypeError("the editor drew nothing");
  }

  const agree = () => {
    const saved = blocksOfValue(device.children);
    expect(reopened(saved)).toStrictEqual(saved);
  };

  return { agree, device, editable };
};

describe.each(KITS)("the %s kit over a stored note", (_, kit) => {
  it("opens a stored note holding what the library's own editor opens, with nothing to save", () => {
    const { agree, device } = mounted(kit);
    agree();
    expect(blocksOfValue(device.children)).toStrictEqual(reopened(SEEDED));
  });

  it("stores what a person types, pastes and undoes, a pill's display with its source", () => {
    const { agree, device, editable } = mounted(kit);

    device.tf.select(device.api.end([0]));
    device.tf.insertText(" there");
    agree();

    device.tf.select(device.api.end([0]));
    fireEvent.paste(editable, {
      clipboardData: {
        files: [],
        getData: (type: string) =>
          type === "text/html" ? "<table><tr><td>a1</td><td>b1</td></tr></table>" : "",
        items: [],
        types: ["text/html"],
      },
    });
    agree();
    expect(device.children.some((node) => node.type === "table")).toBe(true);

    device.tf.setNodes({ source: "1 + 3" }, { at: pillEntries(device.children)[0]?.at });
    agree();
    expect(JSON.stringify(device.children)).toContain('"display":"4"');

    device.tf.undo();
    agree();
    expect(JSON.stringify(device.children)).toContain('"display":"3","source":"1 + 2"');
    device.tf.undo();
    agree();
    expect(device.children.some((node) => node.type === "table")).toBe(false);
    device.tf.undo();
    agree();
    expect(device.api.string([0])).toBe("hello");

    device.tf.redo();
    device.tf.redo();
    device.tf.redo();
    agree();
    expect(device.api.string([0])).toBe("hello there");
    expect(device.children.some((node) => node.type === "table")).toBe(true);
    expect(JSON.stringify(device.children)).toContain('"display":"4","source":"1 + 3"');
  });
});
