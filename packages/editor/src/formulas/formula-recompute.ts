// A changed display rewrites through an editor transaction the undo history never records:
// the user did not type it, so one undo must still reach their own last edit. Parsing never
// rewrites, so a wrong display stays until an editor session recomputes it. Only a bound
// expression that cannot resolve marks stale and keeps its last display; a plain expression that
// cannot evaluate is left alone. A bound ref names its item by id, so the pass reads only the
// items its pills name, through the store the item's session reads (`../item/item-session.ts`),
// and this item's own pills from the live value.

import type { NodeEntry, SlateEditor, TElement } from "platejs";

import {
  collectBoundRefs,
  evaluateExpression,
  parseExpression,
} from "@repo/editor/formulas/expression";
import { formatResult } from "@repo/editor/formulas/format-result";
import { formulasInBlocks } from "@repo/editor/formulas/collect-formulas";
import type { CollectedFormula } from "@repo/editor/formulas/collect-formulas";
import { loadFormulaGraph, resolveExpression } from "@repo/editor/formulas/resolve-graph";
import { parseFormulaMeta, serializeFormulaMeta } from "@repo/editor/formulas/formula-meta";
import { createDebouncer } from "@repo/editor/lib/debounce";
import { isFormulaPill, setFormulaPill } from "@repo/editor/formulas/formula-entry";
import { stringProp } from "@repo/editor/node-props";
import type { ItemStore } from "@repo/editor/item/item-session";

const RECOMPUTE_DEBOUNCE_MS = 400;

interface FormulaEntryInDoc {
  entry: NodeEntry<TElement>;
  collected: CollectedFormula;
}

const formulaEntries = (editor: SlateEditor): FormulaEntryInDoc[] => {
  const out: FormulaEntryInDoc[] = [];
  for (const entry of editor.api.nodes<TElement>({
    at: [],
    match: isFormulaPill,
  })) {
    const [node] = entry;
    const source = stringProp(node, "source") ?? "";
    const display = stringProp(node, "display") ?? "";
    out.push({
      collected: {
        display,
        expression: parseExpression(source),
        meta: parseFormulaMeta(stringProp(node, "meta")),
        source,
      },
      entry,
    });
  }
  return out;
};

// what a pass reads: the item the editor holds, by its id, and the pills of any other item by
// its id, or null for one this device lacks
/** @internal */
export interface FormulaReads {
  readonly selfId: string;
  readonly read: (itemId: string) => Promise<readonly CollectedFormula[] | null>;
}

// an item's pills as the store holds them: its note's, since the note is what the editor shows
// and the article a fill read holds none
const itemFormulas = async (
  store: ItemStore,
  itemId: string,
): Promise<CollectedFormula[] | null> => {
  const held = await store.item(itemId);
  return held === null
    ? null
    : formulasInBlocks(
        held.blocks.flatMap(({ block, section }) => (section === "note" ? [block] : [])),
      );
};

/** @internal */
export const recomputeFormulas = async (
  editor: SlateEditor,
  reads: FormulaReads,
): Promise<void> => {
  const before = editor.children;
  const entries = formulaEntries(editor);
  const executables = entries.filter((row) => row.collected.expression !== null);
  if (executables.length === 0) {
    return;
  }

  const { selfId } = reads;
  const selfFormulas = entries.map((row) => row.collected);
  // an item that cannot be read answers like an absent one: its refs go stale, never the pass
  const graph = await loadFormulaGraph(
    selfFormulas,
    selfId,
    async (itemId) => await reads.read(itemId).catch(() => null),
  );
  // an edit landed during the reads; the next settle reruns
  if (editor.children !== before) {
    return;
  }

  const updates: { entry: NodeEntry<TElement>; props: { display: string; meta: string } }[] = [];
  for (const row of executables) {
    const { expression, meta, display } = row.collected;
    if (expression === null) {
      continue;
    }
    const refs = collectBoundRefs(expression);
    const outcome =
      refs.length === 0
        ? evaluateExpression(expression, () => null)
        : resolveExpression(expression, graph, selfId, selfFormulas);
    if (outcome.ok) {
      const nextDisplay = formatResult(outcome.value);
      if (nextDisplay !== display || meta.stale) {
        const nextMeta = serializeFormulaMeta({ ...meta, stale: false }) ?? "";
        updates.push({
          entry: row.entry,
          props: { display: nextDisplay, meta: nextMeta },
        });
      }
      continue;
    }
    if (refs.length > 0 && !meta.stale) {
      const nextMeta = serializeFormulaMeta({ ...meta, stale: true }) ?? "";
      updates.push({
        entry: row.entry,
        props: { display, meta: nextMeta },
      });
    }
  }
  if (updates.length === 0) {
    return;
  }

  editor.tf.withoutSaving(() => {
    editor.tf.withoutNormalizing(() => {
      for (const update of updates) {
        setFormulaPill(editor, update.entry[1], update.props);
      }
    });
  });
};

// Nothing awaits a scheduled pass, so a throw here would vanish; the display it left stays.
const recomputeReporting = async (editor: SlateEditor, reads: FormulaReads): Promise<void> => {
  try {
    await recomputeFormulas(editor, reads);
  } catch (error) {
    console.error("formula recompute failed", error);
  }
};

const schedulers = new WeakMap<SlateEditor, { schedule: () => void; cancel: () => void }>();

// after an edit: a pass behind the recompute's own pause, for an editor that follows its item's
// formulas; any other editor has none to run
export const scheduleFormulaRecompute = (editor: SlateEditor): void => {
  schedulers.get(editor)?.schedule();
};

// the item's pills recomputed once it opens, after each edit (`scheduleFormulaRecompute`) and when
// another item changes, since a pill may name one; the answer stops all three
export const followItemFormulas = (
  editor: SlateEditor,
  itemId: string,
  store: ItemStore,
): (() => void) => {
  const reads: FormulaReads = {
    read: async (id) => await itemFormulas(store, id),
    selfId: itemId,
  };
  const scheduler = createDebouncer(() => {
    void recomputeReporting(editor, reads);
  }, RECOMPUTE_DEBOUNCE_MS);
  schedulers.set(editor, scheduler);
  scheduler.schedule();
  const unsubscribe = store.onChange((change) => {
    if (change.reset || [...change.ids].some((id) => id !== itemId)) {
      scheduler.schedule();
    }
  });
  return () => {
    unsubscribe();
    scheduler.cancel();
    if (schedulers.get(editor) === scheduler) {
      schedulers.delete(editor);
    }
  };
};
