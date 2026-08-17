// Where a delegation being composed will drop its anchor — held as a POSITION
// THE EDITOR MAPS, not a number the app captured.
//
// The composer's prompt input sits between the selection and the create call,
// and the buffer keeps moving underneath it: the user types, and an agent
// write merges in through the external-change path. A raw offset captured at
// selection time therefore names a different block by the time the prompt is
// submitted — the anchor would bind the wrong content, silently. A StateField
// maps through every change set instead, and `MapMode.TrackDel` answers null
// when the tracked content was deleted outright, which is the one case where
// there is no honest answer and the caller must refuse.

import { MapMode, StateEffect, StateField, type EditorState } from "@codemirror/state";

/** Arm (a position) or disarm (null) the pending anchor. */
export const setPendingAnchor = StateEffect.define<number | null>();

const pendingAnchorField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setPendingAnchor)) {
        return effect.value;
      }
    }
    if (value === null) {
      return null;
    }
    // Associate forward, and report a deletion rather than silently sliding to
    // a neighbour: a vanished block must refuse, never rebind.
    return tr.changes.mapPos(value, 1, MapMode.TrackDel);
  },
});

/** The pending anchor's CURRENT position; null when none is armed or the
 *  content it named is gone. */
export function pendingAnchorPosition(state: EditorState): number | null {
  return state.field(pendingAnchorField, false) ?? null;
}

export const pendingAnchorExtension = pendingAnchorField;
