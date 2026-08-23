// The recompute pass: every executable pill in the OPEN note re-evaluates,
// and a display that changed rewrites through an ordinary editor transaction
// — so the new bytes ride the same serialize/save path a keystroke does, and
// PARSING never rewrites anything (a wrong display on disk stays until an
// editor session recomputes it; the gate stays byte-faithful).
//
// Timing discipline (markdown-editor.tsx's): recompute is debounced behind
// the serialize settle, captures the document identity before its awaits, and
// aborts if ANY edit landed meanwhile — the next settle reschedules it, so
// dropping a pass costs nothing and fighting the user's typing is impossible.
//
// Stale semantics follow the vendored skill exactly: only a BOUND expression
// that cannot resolve (missing target, cycle) marks `stale=1` and keeps its
// last display; a plain expression that cannot evaluate is simply left alone.

import { NodeApi, type NodeEntry, type SlateEditor, type TElement } from "platejs";

import {
  collectBoundRefs,
  evaluateExpression,
  parseExpression,
} from "@repo/notes/formulas/expression";
import { formatResult } from "@repo/notes/formulas/format-result";
import type { CollectedFormula } from "@repo/notes/formulas/collect-formulas";
import { resolveExpression } from "@repo/notes/formulas/resolve-graph";
import { parseFormulaMeta, serializeFormulaMeta } from "@repo/notes/formulas/formula-meta";
import { getEditorHostIo } from "@repo/editor/host-io";
import { createDebouncer } from "@repo/editor/lib/debounce";
import { rebuildRaw } from "@repo/editor/formulas/formula-entry";

const RECOMPUTE_DEBOUNCE_MS = 400;

type FormulaEntryInDoc = {
  entry: NodeEntry<TElement>;
  collected: CollectedFormula;
};

function formulaEntries(editor: SlateEditor): FormulaEntryInDoc[] {
  const out: FormulaEntryInDoc[] = [];
  for (const entry of editor.api.nodes<TElement>({
    at: [],
    match: (node) => NodeApi.isNode(node) && "type" in node && node.type === "formulaPill",
  })) {
    const [node] = entry;
    const source = typeof node.source === "string" ? node.source : "";
    const display = typeof node.display === "string" ? node.display : "";
    const meta = typeof node.meta === "string" && node.meta !== "" ? node.meta : undefined;
    out.push({
      collected: {
        display,
        expression: parseExpression(source),
        meta: parseFormulaMeta(meta),
        source,
      },
      entry,
    });
  }
  return out;
}

/** The note's own id, read off the frontmatter node the editor holds. */
function editorNoteId(editor: SlateEditor): string | null {
  const first = editor.children[0];
  if (first === undefined || first.type !== "frontmatter") return null;
  const yaml = typeof first.value === "string" ? first.value : "";
  const match = /^id:\s*("?)([^"\n]+)\1\s*$/mu.exec(yaml);
  return match?.[2]?.trim() ?? null;
}

async function recompute(editor: SlateEditor): Promise<void> {
  const before = editor.children;
  const entries = formulaEntries(editor);
  const executables = entries.filter((row) => row.collected.expression !== null);
  if (executables.length === 0) return;

  const selfNoteId = editorNoteId(editor);
  const selfFormulas = entries.map((row) => row.collected);

  // Foreign notes named by bound refs, fetched through the host once each.
  const foreign = new Set<string>();
  for (const row of executables) {
    if (row.collected.expression === null) continue;
    for (const ref of collectBoundRefs(row.collected.expression)) {
      if (ref.noteId !== selfNoteId) foreign.add(ref.noteId);
    }
  }
  const notes = new Map<string, readonly CollectedFormula[]>();
  if (foreign.size > 0) {
    const io = getEditorHostIo();
    await Promise.all(
      [...foreign].map(async (noteId) => {
        const answer = await io.readNoteFormulas({ noteId }).catch(() => null);
        if (answer !== null) notes.set(noteId, answer.formulas);
      }),
    );
  }
  // An edit landed while we read — the next settle reruns; touching the tree
  // now would race the keystroke that invalidated this pass.
  if (editor.children !== before) return;

  const updates: Array<{ entry: NodeEntry<TElement>; props: Record<string, string> }> = [];
  for (const row of executables) {
    const { expression, meta, display, source } = row.collected;
    if (expression === null) continue;
    const refs = collectBoundRefs(expression);
    const outcome =
      refs.length === 0
        ? evaluateExpression(expression, () => null)
        : resolveExpression(expression, { notes }, selfNoteId, selfFormulas);
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
    // Only a bound expression goes stale; its display is the last known value.
    if (refs.length > 0 && !meta.stale) {
      const nextMeta = serializeFormulaMeta({ ...meta, stale: true }) ?? "";
      updates.push({
        entry: row.entry,
        props: { display, meta: nextMeta, raw: rebuildRaw(source, display, nextMeta) },
      });
    }
  }
  if (updates.length === 0) return;

  editor.tf.withoutNormalizing(() => {
    for (const update of updates) {
      editor.tf.setNodes(update.props, { at: update.entry[1] });
    }
  });
}

const schedulers = new WeakMap<SlateEditor, { schedule: () => void; cancel: () => void }>();

/** Debounced per editor; safe to call from every settle. */
export function scheduleFormulaRecompute(editor: SlateEditor): void {
  let scheduler = schedulers.get(editor);
  if (scheduler === undefined) {
    scheduler = createDebouncer(() => {
      void recompute(editor).catch(() => {});
    }, RECOMPUTE_DEBOUNCE_MS);
    schedulers.set(editor, scheduler);
  }
  scheduler.schedule();
}

export function cancelFormulaRecompute(editor: SlateEditor): void {
  schedulers.get(editor)?.cancel();
}
