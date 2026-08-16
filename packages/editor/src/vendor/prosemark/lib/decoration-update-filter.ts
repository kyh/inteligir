// House seam, NOT upstream ProseMark — see PROVENANCE.md. Upstream's hide and
// fold StateFields rebuild on every selection change, which flickers during a
// drag-selection; writer-computer forked ProseMark for exactly this hook. The
// two cores consult this facet before rebuilding on a selection-only
// transaction, so a drag-freeze extension can defer the rebuild without
// forking the fields.
import { Facet, type Transaction } from "@codemirror/state";

/**
 * Consulted on selection-only transactions. When any registered filter returns
 * false, the hide/fold fields map their old decorations forward instead of
 * rebuilding; doc and syntax-tree changes always rebuild.
 */
export type SelectionRebuildFilter = (tr: Transaction) => boolean;

export const selectionRebuildFilter = Facet.define<SelectionRebuildFilter>();

export const allowsSelectionRebuild = (tr: Transaction): boolean =>
  tr.state.facet(selectionRebuildFilter).every((filter) => filter(tr));
