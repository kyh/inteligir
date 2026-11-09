// Live documents over no socket: each relays its updates to the others as a note's object relays a
// socket's, held until delivered, so two editors can write at once and meet afterwards.

import { createSlateEditor } from "platejs";
import type { AnyPluginConfig, SlateEditor } from "platejs";
import { YjsEditor, yTextToSlateElement } from "@slate-yjs/core";
import type { Descendant } from "slate";
import * as Y from "yjs";

import { BASE_KIT } from "@repo/editor/kits/base-kit";
import { YHistoryPlugin, noteRoot, yjsBindingPlugin } from "@repo/editor/live/yjs-binding";

// the origin a relayed update lands under, which no editor writes as
const RELAYED = Symbol("relayed");

export interface Relay {
  // hands every held update to every other document, and what those land writes in turn
  readonly deliver: () => void;
  // the updates a document made itself, relayed ones aside
  readonly sent: (doc: Y.Doc) => number;
}

export const relay = (docs: readonly Y.Doc[]): Relay => {
  const held: { from: Y.Doc; update: Uint8Array }[] = [];
  const sent = new Map<Y.Doc, number>();
  for (const doc of docs) {
    sent.set(doc, 0);
    doc.on("update", (update, _origin, _doc, transaction) => {
      if (transaction.local) {
        sent.set(doc, (sent.get(doc) ?? 0) + 1);
        held.push({ from: doc, update });
      }
    });
  }
  return {
    deliver: () => {
      for (let next = held.shift(); next !== undefined; next = held.shift()) {
        for (const doc of docs) {
          if (doc !== next.from) {
            Y.applyUpdate(doc, next.update, RELAYED);
          }
        }
      }
    },
    sent: (doc) => sent.get(doc) ?? 0,
  };
};

// a document holding what `source` holds, as a device's does once it has synced
export const syncedCopy = (source: Y.Doc): Y.Doc => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(source), RELAYED);
  return doc;
};

export type LiveEditor = SlateEditor & YjsEditor;

// An editor bound to `doc` and connected, with node ids on as the app runs them (Plate turns them
// off under NODE_ENV=test); `history` adds the person's undo, which the note's own editor lacks.
export const liveEditor = (
  doc: Y.Doc,
  {
    kit = BASE_KIT,
    history = true,
  }: { readonly kit?: readonly AnyPluginConfig[]; readonly history?: boolean } = {},
): LiveEditor => {
  const editor = createSlateEditor({
    nodeId: true,
    plugins: [
      ...kit,
      yjsBindingPlugin({ localOrigin: Symbol("local"), root: noteRoot(doc) }),
      ...(history ? [YHistoryPlugin] : []),
    ],
  });
  if (!YjsEditor.isYjsEditor(editor)) {
    throw new Error("the binding did not bind");
  }
  YjsEditor.connect(editor);
  return editor;
};

// what the document holds, as Slate nodes
export const docNodes = (doc: Y.Doc): Descendant[] => yTextToSlateElement(noteRoot(doc)).children;

// writes what each editor holds unsent, then delivers, until nothing moves
export const settle = (net: Relay, editors: readonly LiveEditor[]): void => {
  for (let round = 0; round < 10; round += 1) {
    for (const editor of editors) {
      YjsEditor.flushLocalChanges(editor);
    }
    net.deliver();
    if (editors.every((editor) => YjsEditor.localChanges(editor).length === 0)) {
      return;
    }
  }
  throw new Error("the documents never settled");
};
