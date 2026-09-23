import { collectBoundRefs, evaluateExpression } from "./expression";
import type { BoundRef, ExpressionNode } from "./expression";
import { formulasById } from "./collect-formulas";
import type { CollectedFormula } from "./collect-formulas";

export interface FormulaGraph {
  notes: ReadonlyMap<string, readonly CollectedFormula[]>;
}

type ReadNoteFormulas = (noteId: string) => Promise<readonly CollectedFormula[] | null>;

// 64 bounds what one recompute may read; a note past the cap answers missing-ref like an absent one.
const MAX_GRAPH_NOTES = 64;

const boundNoteIds = (formulas: readonly CollectedFormula[]): string[] =>
  formulas.flatMap((formula) =>
    formula.expression === null
      ? []
      : collectBoundRefs(formula.expression).map((ref) => ref.noteId),
  );

// Breadth-first from the roots' refs, so a chain through notes the roots never name still
// resolves. Self is never read: resolveExpression answers it from the live buffer. Each level
// reads in parallel but files its answers in the order it asked, so which notes fit under the
// cap does not depend on which read lands first.
export const loadFormulaGraph = async (
  roots: readonly CollectedFormula[],
  selfNoteId: string | null,
  read: ReadNoteFormulas,
  maxNotes = MAX_GRAPH_NOTES,
): Promise<FormulaGraph> => {
  const notes = new Map<string, readonly CollectedFormula[]>();
  const asked = new Set<string>();
  const unasked = (noteIds: readonly string[]): string[] => {
    const fresh: string[] = [];
    for (const noteId of noteIds) {
      if (noteId !== selfNoteId && !asked.has(noteId) && asked.size < maxNotes) {
        asked.add(noteId);
        fresh.push(noteId);
      }
    }
    return fresh;
  };
  let level = unasked(boundNoteIds(roots));
  while (level.length > 0) {
    const answers = await Promise.all(
      level.map(async (noteId) => ({ formulas: await read(noteId), noteId })),
    );
    const found: CollectedFormula[] = [];
    for (const { formulas, noteId } of answers) {
      if (formulas !== null) {
        notes.set(noteId, formulas);
        found.push(...formulas);
      }
    }
    level = unasked(boundNoteIds(found));
  }
  return { notes };
};

export type ResolveOutcome =
  | { ok: true; value: number }
  | { ok: false; reason: "missing-ref" | "cyclic" | "not-finite" };

// selfFormulas answers refs into this note even when the graph has no entry for it yet
export const resolveExpression = (
  expression: ExpressionNode,
  graph: FormulaGraph,
  selfNoteId: string | null,
  selfFormulas: readonly CollectedFormula[],
): ResolveOutcome => {
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
      if (formulas === undefined) {
        return undefined;
      }
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
    if (memoized !== undefined) {
      return memoized;
    }
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
  if (outcome.ok) {
    return outcome;
  }
  if (sawCycle) {
    return { ok: false, reason: "cyclic" };
  }
  return { ok: false, reason: outcome.reason };
};
