// The cross-note value graph: evaluate an expression whose bound references
// reach other formulas, possibly in other notes, with cycles and misses
// answered as STALE rather than half-computed. Pure — the caller supplies
// every note's collected formulas; nothing here reads a file.

import { evaluateExpression, type BoundRef, type ExpressionNode } from "./expression";
import { formulasById, type CollectedFormula } from "./collect-formulas";

export type FormulaGraph = {
  /** A note's formulas by its frontmatter id. */
  notes: ReadonlyMap<string, readonly CollectedFormula[]>;
};

export type ResolveOutcome =
  | { ok: true; value: number }
  | { ok: false; reason: "missing-ref" | "cyclic" | "not-finite" };

/**
 * Evaluate `expression` against the graph. `selfNoteId` names the note the
 * expression lives in — a bound ref whose noteId matches resolves locally
 * even when the graph has no entry for it (a note without a persisted id yet
 * still resolves its own variables via `selfFormulas`).
 */
export function resolveExpression(
  expression: ExpressionNode,
  graph: FormulaGraph,
  selfNoteId: string | null,
  selfFormulas: readonly CollectedFormula[],
): ResolveOutcome {
  const byNote = new Map<string, Map<string, CollectedFormula>>();
  const selfById = formulasById(selfFormulas);
  const inProgress = new Set<string>();
  const memo = new Map<string, number | null>();
  let sawCycle = false;

  const lookup = (ref: BoundRef): CollectedFormula | undefined => {
    if (ref.noteId === selfNoteId) {
      return selfById.get(ref.formulaId);
    }
    let byId = byNote.get(ref.noteId);
    if (byId === undefined) {
      const formulas = graph.notes.get(ref.noteId);
      if (formulas === undefined) return undefined;
      byId = formulasById(formulas);
      byNote.set(ref.noteId, byId);
    }
    return byId.get(ref.formulaId);
  };

  const valueOf = (ref: BoundRef): number | null => {
    const key = `${ref.noteId}#${ref.formulaId}`;
    if (inProgress.has(key)) {
      sawCycle = true;
      return null;
    }
    const memoized = memo.get(key);
    if (memoized !== undefined) return memoized;
    const target = lookup(ref);
    let value: number | null = null;
    if (target !== undefined && target.expression !== null) {
      inProgress.add(key);
      const outcome = evaluateExpression(target.expression, valueOf);
      inProgress.delete(key);
      value = outcome.ok ? outcome.value : null;
    }
    memo.set(key, value);
    return value;
  };

  const outcome = evaluateExpression(expression, valueOf);
  if (outcome.ok) return outcome;
  if (sawCycle) return { ok: false, reason: "cyclic" };
  return { ok: false, reason: outcome.reason };
}
