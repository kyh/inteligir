// The kits a person types in, mounted as the app draws them and bound to a note's live document:
// what each writes is what the document holds, and the note's own editor reads it alike.

import { fireEvent, render } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AnyPluginConfig } from "platejs";
import { Plate, PlateContent, createPlateEditor } from "platejs/react";
import type { PlateEditor } from "platejs/react";
import { YjsEditor } from "@slate-yjs/core";
import * as Y from "yjs";

import { recomputeFormulas } from "@repo/editor/formulas/formula-recompute";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { TOUCH_EDITOR_KIT } from "@repo/editor/kits/touch-editor-kit";
import { blockOfElement } from "@repo/editor/live/element-block";
import { readBlocks, seedDoc } from "@repo/editor/live/note-blocks";
import { YHistoryPlugin, noteRoot, yjsBindingPlugin } from "@repo/editor/live/yjs-binding";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

import { liveEditor, relay, settle, syncedCopy } from "../test-support/live-notes";

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

// the person's device, drawn with its kit, and the note's own headless editor, both synced
const mounted = (kit: readonly AnyPluginConfig[]) => {
  const seeded = new Y.Doc();
  seedDoc(seeded, [
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
  ]);
  const deviceDoc = syncedCopy(seeded);
  const objectDoc = syncedCopy(seeded);
  const net = relay([deviceDoc, objectDoc]);
  const device: PlateEditor = createPlateEditor({
    nodeId: true,
    plugins: [
      ...kit,
      yjsBindingPlugin({ localOrigin: Symbol("device"), root: noteRoot(deviceDoc) }),
      YHistoryPlugin,
    ],
  });
  if (!YjsEditor.isYjsEditor(device)) {
    throw new Error("the binding did not bind");
  }
  YjsEditor.connect(device);
  const object = liveEditor(objectDoc, { history: false });
  const view = render(
    <Plate editor={device}>
      <PlateContent />
    </Plate>,
  );
  const editable = view.container.querySelector("[data-slate-editor]");
  if (!(editable instanceof HTMLElement)) {
    throw new TypeError("the editor drew nothing");
  }
  // as the library reads each: the document holds no empty text, where Slate keeps one beside an
  // inline that ends a block
  const agree = (): void => {
    settle(net, [device, object]);
    const held = readBlocks(deviceDoc).map(({ block }) => block);
    expect(device.children.flatMap((node) => blockOfElement(node) ?? [])).toStrictEqual(held);
    expect(object.children.flatMap((node) => blockOfElement(node) ?? [])).toStrictEqual(held);
    expect(readBlocks(objectDoc)).toStrictEqual(readBlocks(deviceDoc));
  };
  return { agree, device, deviceDoc, editable, net, object, objectDoc };
};

describe.each(KITS)("the %s kit bound to a note's live document", (_, kit) => {
  it("connects to a seeded note without writing to it", () => {
    const { agree, deviceDoc, net } = mounted(kit);
    agree();
    expect(net.sent(deviceDoc)).toBe(0);
  });

  it("writes what a person types, pastes and undoes, and a recompute stays out of the undo", async () => {
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

    await recomputeFormulas(device, { read: async () => null, selfId: "note" });
    agree();
    const shown = device.api.string(device.children.find((node) => node.id === "sum") ?? []);

    device.tf.undo();
    agree();
    expect(device.children.some((node) => node.type === "table")).toBe(false);
    device.tf.undo();
    agree();
    expect(device.api.string([0])).toBe("hello");
    expect(JSON.stringify(device.children)).toContain('"display":"3"');

    device.tf.redo();
    device.tf.redo();
    agree();
    expect(device.api.string([0])).toBe("hello there");
    expect(device.children.some((node) => node.type === "table")).toBe(true);
    expect(device.api.string(device.children.find((node) => node.id === "sum") ?? [])).toBe(shown);
  });
});
