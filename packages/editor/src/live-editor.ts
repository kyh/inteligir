import type { SlateEditor } from "platejs";

const editors = new Map<string, SlateEditor>();
const waiting = new Map<string, Set<(editor: SlateEditor) => void>>();

export const registerLiveEditor = (itemId: string, editor: SlateEditor) => {
  editors.set(itemId, editor);

  for (const run of waiting.get(itemId) ?? []) {
    run(editor);
  }

  waiting.delete(itemId);

  return (() => {
    if (editors.get(itemId) === editor) {
      editors.delete(itemId);
    }
  }) satisfies () => void;
};

export const getLiveEditor = (itemId: string) => editors.get(itemId) ?? null;

export const onLiveEditor = (itemId: string, run: (editor: SlateEditor) => void) => {
  const editor = editors.get(itemId);

  if (editor !== undefined) {
    run(editor);

    return () => null;
  }

  const runs = waiting.get(itemId) ?? new Set();
  runs.add(run);
  waiting.set(itemId, runs);

  return (() => {
    runs.delete(run);

    if (runs.size === 0 && waiting.get(itemId) === runs) {
      waiting.delete(itemId);
    }
  }) satisfies () => void;
};
