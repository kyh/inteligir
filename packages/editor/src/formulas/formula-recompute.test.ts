import { deferred } from "@repo/editor/deferred";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ElementApi, createSlateEditor } from "platejs";
import type { SlateEditor, TElement } from "platejs";

import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { formulasIn } from "@repo/editor/test-support/formulas-in";
import {
  followItemFormulas,
  recomputeFormulas,
  scheduleFormulaRecompute,
} from "@repo/editor/formulas/formula-recompute";
import type { FormulaReads } from "@repo/editor/formulas/formula-recompute";
import type { EditorHostIo } from "@repo/editor/host-io";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { parseMarkdown } from "@repo/editor/markdown/markdown-doc";
import { stringProp } from "@repo/editor/node-props";
import { seedDoc } from "@repo/editor/live/note-blocks";
import { undoStackSizes } from "@repo/editor/live/yjs-binding";
import { liveEditor } from "../test-support/live-notes";
import { YjsEditor } from "@slate-yjs/core";
import * as Y from "yjs";

const editorWith = (md: string) => {
  const parsed = parseMarkdown(md);
  if (!parsed.ok) {
    throw new Error("fixture must parse");
  }
  return createSlateEditor({ plugins: EDITOR_KIT, value: parsed.value });
};

const pills = (editor: SlateEditor): { display: string; meta: string }[] => {
  const out: { display: string; meta: string }[] = [];
  for (const [node] of editor.api.nodes<TElement>({ at: [], match: { type: "formulaPill" } })) {
    if (ElementApi.isElement(node)) {
      out.push({
        display: stringProp(node, "display") ?? "",
        meta: stringProp(node, "meta") ?? "",
      });
    }
  }
  return out;
};

const lastPill = (editor: SlateEditor) => pills(editor).at(-1);

// the item the editor holds is `selfId`; every other item, by its id, answered as the store would:
// its collected formulas
const readsOver = (selfId: string, items: Readonly<Record<string, string>>) => {
  const asked: string[] = [];
  const reads: FormulaReads = {
    read: async (itemId) => {
      asked.push(itemId);
      const markdown = items[itemId];
      return await Promise.resolve(markdown === undefined ? null : formulasIn(markdown));
    },
    selfId,
  };
  return { asked, reads };
};

// the edit and the recompute arrive on separate turns, as the settle debounce delivers them
const nextTurn = async (): Promise<void> => {
  // oxlint-disable-next-line promise/avoid-new -- setTimeout has no promise-native form here
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
};

describe("the recompute's display rewrite", () => {
  it("corrects a plain expression's display without adding an undo step", async () => {
    const { reads } = readsOver("A", {});
    const editor = editorWith('Total :formula[5]{source="2+2"}\n');

    await recomputeFormulas(editor, reads);

    expect(lastPill(editor)?.display).toBe("4");
    expect(editor.history.undos).toHaveLength(0);
  });

  it("leaves one undo to revert the user's own edit, and one redo to bring it back", async () => {
    const { reads } = readsOver("A", {});
    const editor = editorWith('Total :formula[5]{source="2+2"} tail\n');
    editor.tf.select(editor.api.end([0]));
    editor.tf.insertText("!");
    await nextTurn();

    await recomputeFormulas(editor, reads);
    expect(lastPill(editor)?.display).toBe("4");

    editor.undo();

    expect(editor.api.string([0])).not.toContain("!");
    expect(lastPill(editor)?.display).toBe("4");
    expect(editor.history.redos).toHaveLength(1);
  });
});

describe("the item a bound ref names", () => {
  it("is this item when it names this item's id, so nothing is read", async () => {
    const { asked, reads } = readsOver("N1", {});
    const editor = editorWith(
      ':formula[5]{source="5" meta="id=F1;name=a"} and :formula[0]{source="@(a#N1#F1)*2" meta="id=F2;name=b"}\n',
    );

    await recomputeFormulas(editor, reads);

    expect(lastPill(editor)).toStrictEqual({ display: "10", meta: "id=F2;name=b" });
    expect(asked).toStrictEqual([]);
  });

  it("resolves through a chain of items this one never names", async () => {
    const { asked, reads } = readsOver("A", {
      B: ':formula[0]{source="@(c#C#fc)+1" meta="id=fb;name=b"}\n',
      C: ':formula[40]{source="40" meta="id=fc;name=c"}\n',
    });
    const editor = editorWith(':formula[0]{source="@(b#B#fb)*2" meta="id=fa;name=a"}\n');

    await recomputeFormulas(editor, reads);

    expect(lastPill(editor)?.display).toBe("82");
    expect(asked).toStrictEqual(["B", "C"]);
  });

  it("goes stale when its item cannot be found or read, keeping the last display", async () => {
    const editor = editorWith(':formula[7]{source="@(x#GONE#fx)+1" meta="id=f1"}\n');
    await recomputeFormulas(editor, readsOver("A", {}).reads);
    expect(lastPill(editor)).toStrictEqual({ display: "7", meta: "id=f1;stale=1" });

    const failing = editorWith(':formula[7]{source="@(x#B#fx)+1" meta="id=f1"}\n');
    await recomputeFormulas(failing, {
      read: async () => await Promise.reject(new Error("the store is closed")),
      selfId: "A",
    });
    expect(lastPill(failing)).toStrictEqual({ display: "7", meta: "id=f1;stale=1" });
  });

  it("writes nothing when an edit lands during the read", async () => {
    const read = deferred<string>();
    const editor = editorWith(':formula[0]{source="@(b#B#fb)*2" meta="id=fa;name=a"} tail\n');

    const pass = recomputeFormulas(editor, {
      read: async () => formulasIn(await read.promise),
      selfId: "A",
    });
    await nextTurn();
    editor.tf.select(editor.api.end([0]));
    editor.tf.insertText("!");
    read.resolve(':formula[21]{source="21" meta="id=fb;name=b"}\n');
    await pass;

    expect(lastPill(editor)).toStrictEqual({ display: "0", meta: "id=fa;name=a" });
  });
});

// a paragraph holding one pill, as the library holds it
const pillBlock = (id: string, source: string, display: string, meta: string): LibraryBlock => ({
  children: [
    { text: "" },
    { children: [{ text: "" }], display, meta, source, type: "formulaPill" },
    { text: "" },
  ],
  id,
  type: "p",
});

// the host's reads of the items named, which the case changes and announces
const hostOf = (items: Map<string, readonly LibraryBlock[]>) => {
  const listeners = new Set<(ids: ReadonlySet<string> | null) => void>();
  const asked: string[] = [];
  const host: Pick<EditorHostIo, "readItemBlocks" | "onItemsChanged"> = {
    onItemsChanged: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    readItemBlocks: async (itemId) => {
      asked.push(itemId);
      return await Promise.resolve(items.get(itemId) ?? null);
    },
  };
  const announce = (ids: readonly string[] | null): void => {
    for (const listener of listeners) {
      listener(ids === null ? null : new Set(ids));
    }
  };
  return { announce, asked, host, listeners };
};

describe("following an item's formulas", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the item a ref names, and runs again when another item changes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const items = new Map([["B", [pillBlock("b1", "40", "40", "id=fb;name=b")]]]);
    const { announce, asked, host, listeners } = hostOf(items);
    const editor = editorWith(':formula[0]{source="@(b#B#fb)+2" meta="id=fa;name=a"}\n');

    const stop = followItemFormulas(editor, "A", host);
    await vi.advanceTimersByTimeAsync(400);
    expect(pills(editor)).toStrictEqual([{ display: "42", meta: "id=fa;name=a" }]);

    // this item's own change moves nothing a pill reads elsewhere; another item's does, and so
    // does a word that any item may have moved
    items.set("B", [pillBlock("b1", "50", "50", "id=fb;name=b")]);
    announce(["A"]);
    await vi.advanceTimersByTimeAsync(400);
    expect(asked).toStrictEqual(["B"]);
    announce(["B"]);
    await vi.advanceTimersByTimeAsync(400);
    expect(pills(editor)[0]?.display).toBe("52");
    items.set("B", [pillBlock("b1", "60", "60", "id=fb;name=b")]);
    announce(null);
    await vi.advanceTimersByTimeAsync(400);
    expect(pills(editor)[0]?.display).toBe("62");

    stop();
    expect(listeners.size).toBe(0);
    scheduleFormulaRecompute(editor);
    await vi.advanceTimersByTimeAsync(400);
    expect(asked).toStrictEqual(["B", "B", "B"]);
  });

  it("writes the display outside a live note's undo, so an undo reaches the person's own edit", async () => {
    const doc = new Y.Doc();
    seedDoc(doc, [
      {
        block: pillBlock("0190a000-0000-7000-8000-0000000000f1", "2+2", "5", "id=fa;name=a"),
        section: "note",
      },
    ]);
    const editor = liveEditor(doc, { kit: EDITOR_KIT });
    editor.tf.insertText("!", { at: editor.api.end([0]) });
    YjsEditor.flushLocalChanges(editor);

    await recomputeFormulas(editor, readsOver("A", {}).reads);
    YjsEditor.flushLocalChanges(editor);
    expect(lastPill(editor)?.display).toBe("4");

    editor.undo();
    expect(editor.api.string([0])).not.toContain("!");
    expect(lastPill(editor)?.display).toBe("4");
    expect(undoStackSizes(editor)).toStrictEqual({ redos: 1, undos: 0 });
  });
});
