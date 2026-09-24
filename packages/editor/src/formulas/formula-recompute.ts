// A changed display rewrites through an editor transaction the undo history never records:
// the user did not type it, so one undo must still reach their own last edit. Parsing never
// rewrites, so a wrong display on disk stays until an editor session recomputes it.
// Only a bound expression that cannot resolve marks stale and keeps its last
// display; a plain expression that cannot evaluate is left alone.

import { NodeApi } from "platejs";
import type { NodeEntry, SlateEditor, TElement } from "platejs";

import {
  collectBoundRefs,
  evaluateExpression,
  parseExpression,
} from "@repo/notes/formulas/expression";
import { formatResult } from "@repo/notes/formulas/format-result";
import type { CollectedFormula } from "@repo/notes/formulas/collect-formulas";
import { loadFormulaGraph, resolveExpression } from "@repo/notes/formulas/resolve-graph";
import { parseFormulaMeta, serializeFormulaMeta } from "@repo/notes/formulas/formula-meta";
import { noteIdOfProperties, parseProperties } from "@repo/notes/markdown/frontmatter";
import { FORMULA_PILL_KEY } from "@repo/editor/dialect-node-keys";
import { getEditorHostIo } from "@repo/editor/host-io";
import { createDebouncer } from "@repo/editor/lib/debounce";
import { rebuildRaw } from "@repo/editor/formulas/formula-entry";
import { stringProp } from "@repo/editor/node-props";
import { readFrontmatterRaw } from "@repo/editor/properties/properties-node";

const RECOMPUTE_DEBOUNCE_MS = 400;

interface FormulaEntryInDoc {
  entry: NodeEntry<TElement>;
  collected: CollectedFormula;
}

const formulaEntries = (editor: SlateEditor): FormulaEntryInDoc[] => {
  const out: FormulaEntryInDoc[] = [];
  for (const entry of editor.api.nodes<TElement>({
    at: [],
    match: (node) => NodeApi.isNode(node) && "type" in node && node.type === FORMULA_PILL_KEY,
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

// A note that cannot be read answers like an absent one: its refs go stale, never the whole pass.
const readForeignFormulas = async (noteId: string): Promise<CollectedFormula[] | null> => {
  const answer = await getEditorHostIo()
    .readNoteFormulas({ noteId })
    .catch(() => null);
  return answer?.formulas ?? null;
};

export const recomputeFormulas = async (editor: SlateEditor): Promise<void> => {
  const before = editor.children;
  const entries = formulaEntries(editor);
  const executables = entries.filter((row) => row.collected.expression !== null);
  if (executables.length === 0) {
    return;
  }

  const selfNoteId = noteIdOfProperties(parseProperties(readFrontmatterRaw(editor) ?? ""));
  const selfFormulas = entries.map((row) => row.collected);
  const graph = await loadFormulaGraph(selfFormulas, selfNoteId, readForeignFormulas);
  // an edit landed during the reads; the next settle reruns
  if (editor.children !== before) {
    return;
  }

  const updates: { entry: NodeEntry<TElement>; props: Record<string, string> }[] = [];
  for (const row of executables) {
    const { expression, meta, display, source } = row.collected;
    if (expression === null) {
      continue;
    }
    const refs = collectBoundRefs(expression);
    const outcome =
      refs.length === 0
        ? evaluateExpression(expression, () => null)
        : resolveExpression(expression, graph, selfNoteId, selfFormulas);
    if (outcome.ok) {
      const nextDisplay = formatResult(outcome.value);
      if (nextDisplay !== display || meta.stale) {
        const nextMeta = serializeFormulaMeta({ ...meta, stale: false }) ?? "";
        updates.push({
          entry: row.entry,
          props: {
            display: nextDisplay,
            meta: nextMeta,
            raw: rebuildRaw(source, nextDisplay, nextMeta),
          },
        });
      }
      continue;
    }
    if (refs.length > 0 && !meta.stale) {
      const nextMeta = serializeFormulaMeta({ ...meta, stale: true }) ?? "";
      updates.push({
        entry: row.entry,
        props: { display, meta: nextMeta, raw: rebuildRaw(source, display, nextMeta) },
      });
    }
  }
  if (updates.length === 0) {
    return;
  }

  editor.tf.withoutSaving(() => {
    editor.tf.withoutNormalizing(() => {
      for (const update of updates) {
        editor.tf.setNodes(update.props, { at: update.entry[1] });
      }
    });
  });
};

// Nothing awaits a scheduled pass, so a throw here would vanish; the display it left stays.
const recomputeReporting = async (editor: SlateEditor): Promise<void> => {
  try {
    await recomputeFormulas(editor);
  } catch (error) {
    console.error("formula recompute failed", error);
  }
};

const schedulers = new WeakMap<SlateEditor, { schedule: () => void; cancel: () => void }>();

export const scheduleFormulaRecompute = (editor: SlateEditor): void => {
  let scheduler = schedulers.get(editor);
  if (scheduler === undefined) {
    scheduler = createDebouncer(() => {
      void recomputeReporting(editor);
    }, RECOMPUTE_DEBOUNCE_MS);
    schedulers.set(editor, scheduler);
  }
  scheduler.schedule();
};

export const cancelFormulaRecompute = (editor: SlateEditor): void => {
  schedulers.get(editor)?.cancel();
};
