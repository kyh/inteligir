import { deferred } from "@repo/editor/deferred";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ElementApi, createSlateEditor } from "platejs";
import type { TElement } from "platejs";

import { blockHash } from "@repo/contract/library/block-hash";
import type { LibraryBlock, LibrarySection } from "@repo/contract/library/library-nodes";
import { noteFields } from "@repo/contract/test-support/library-items";
import { formulasIn } from "@repo/editor/test-support/formulas-in";
import {
  followItemFormulas,
  recomputeFormulas,
  scheduleFormulaRecompute,
} from "@repo/editor/formulas/formula-recompute";
import type { FormulaReads } from "@repo/editor/formulas/formula-recompute";
import type { HeldItem, ItemStore, ItemStoreChange } from "@repo/editor/item/item-session";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { parseMarkdown } from "@repo/editor/markdown/markdown-doc";
import { stringProp } from "@repo/editor/node-props";

const editorWith = (md: string) => {
  const parsed = parseMarkdown(md);
  if (!parsed.ok) {
    throw new Error("fixture must parse");
  }
  return createSlateEditor({ plugins: EDITOR_KIT, value: parsed.value });
};

type Editor = ReturnType<typeof editorWith>;

const pills = (editor: Editor): { display: string; meta: string }[] => {
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

const lastPill = (editor: Editor) => pills(editor).at(-1);

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
    const editor = editorWith("Total {{2+2|5}}\n");

    await recomputeFormulas(editor, reads);

    expect(lastPill(editor)?.display).toBe("4");
    expect(editor.history.undos).toHaveLength(0);
  });

  it("leaves one undo to revert the user's own edit, and one redo to bring it back", async () => {
    const { reads } = readsOver("A", {});
    const editor = editorWith("Total {{2+2|5}} tail\n");
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
    const editor = editorWith("{{5|5|id=F1;name=a}} and {{@(a#N1#F1)*2|0|id=F2;name=b}}\n");

    await recomputeFormulas(editor, reads);

    expect(lastPill(editor)).toStrictEqual({ display: "10", meta: "id=F2;name=b" });
    expect(asked).toStrictEqual([]);
  });

  it("resolves through a chain of items this one never names", async () => {
    const { asked, reads } = readsOver("A", {
      B: "{{@(c#C#fc)+1|0|id=fb;name=b}}\n",
      C: "{{40|40|id=fc;name=c}}\n",
    });
    const editor = editorWith("{{@(b#B#fb)*2|0|id=fa;name=a}}\n");

    await recomputeFormulas(editor, reads);

    expect(lastPill(editor)?.display).toBe("82");
    expect(asked).toStrictEqual(["B", "C"]);
  });

  it("goes stale when its item cannot be found or read, keeping the last display", async () => {
    const editor = editorWith("{{@(x#GONE#fx)+1|7|id=f1}}\n");
    await recomputeFormulas(editor, readsOver("A", {}).reads);
    expect(lastPill(editor)).toStrictEqual({ display: "7", meta: "id=f1;stale=1" });

    const failing = editorWith("{{@(x#B#fx)+1|7|id=f1}}\n");
    await recomputeFormulas(failing, {
      read: async () => await Promise.reject(new Error("the store is closed")),
      selfId: "A",
    });
    expect(lastPill(failing)).toStrictEqual({ display: "7", meta: "id=f1;stale=1" });
  });

  it("writes nothing when an edit lands during the read", async () => {
    const read = deferred<string>();
    const editor = editorWith("{{@(b#B#fb)*2|0|id=fa;name=a}} tail\n");

    const pass = recomputeFormulas(editor, {
      read: async () => formulasIn(await read.promise),
      selfId: "A",
    });
    await nextTurn();
    editor.tf.select(editor.api.end([0]));
    editor.tf.insertText("!");
    read.resolve("{{21|21|id=fb;name=b}}\n");
    await pass;

    expect(lastPill(editor)).toStrictEqual({ display: "0", meta: "id=fa;name=a" });
  });
});

// a paragraph holding one pill, as the store holds it
const pillBlock = (id: string, source: string, display: string, meta: string): LibraryBlock => ({
  children: [
    { text: "" },
    { children: [{ text: "" }], display, meta, source, type: "formulaPill" },
    { text: "" },
  ],
  id,
  type: "p",
});

const heldOf = (blocks: readonly { block: LibraryBlock; section: LibrarySection }[]): HeldItem => ({
  blocks: blocks.map(({ block, section }, at) => ({
    block,
    hash: blockHash(block),
    ord: `a${String(at)}`,
    section,
  })),
  bodyHeld: true,
  fields: noteFields({ title: "B" }),
});

// a store holding the items named, which the case changes and announces
const storeOf = (items: Map<string, HeldItem>) => {
  const listeners = new Set<(change: ItemStoreChange) => void>();
  const asked: string[] = [];
  const store: ItemStore = {
    item: async (itemId) => {
      asked.push(itemId);
      return await Promise.resolve(items.get(itemId) ?? null);
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    write: async () => await Promise.resolve({ kind: "queued" }),
  };
  const announce = (ids: readonly string[]): void => {
    for (const listener of listeners) {
      listener({ ids: new Set(ids), overlapped: new Set(), reset: false });
    }
  };
  return { announce, asked, listeners, store };
};

describe("following an item's formulas", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the note of the item a ref names, and runs again when another item changes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const items = new Map([
      [
        "B",
        heldOf([
          { block: pillBlock("b1", "40", "40", "id=fb;name=b"), section: "note" },
          // a fill's article holds no pill a ref may name
          { block: pillBlock("b2", "99", "99", "id=fz;name=z"), section: "article" },
        ]),
      ],
    ]);
    const { announce, asked, listeners, store } = storeOf(items);
    const editor = editorWith("{{@(b#B#fb)+2|0|id=fa;name=a}} {{@(z#B#fz)|0|id=fy;name=y}}\n");

    const stop = followItemFormulas(editor, "A", store);
    await vi.advanceTimersByTimeAsync(400);
    expect(pills(editor)).toStrictEqual([
      { display: "42", meta: "id=fa;name=a" },
      { display: "0", meta: "id=fy;name=y;stale=1" },
    ]);

    // this item's own write moves nothing a pill reads elsewhere; another item's does
    items.set(
      "B",
      heldOf([{ block: pillBlock("b1", "50", "50", "id=fb;name=b"), section: "note" }]),
    );
    announce(["A"]);
    await vi.advanceTimersByTimeAsync(400);
    expect(asked).toStrictEqual(["B"]);
    announce(["B"]);
    await vi.advanceTimersByTimeAsync(400);
    expect(pills(editor)[0]?.display).toBe("52");

    stop();
    expect(listeners.size).toBe(0);
    scheduleFormulaRecompute(editor);
    await vi.advanceTimersByTimeAsync(400);
    expect(asked).toStrictEqual(["B", "B"]);
  });
});
