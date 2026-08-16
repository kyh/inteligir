import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { selectionRebuildFilter } from "./vendor/prosemark/lib/decoration-update-filter";

const setDragFreeze = StateEffect.define<boolean>();

const dragFreezeField = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => {
    for (const effect of tr.effects) {
      if (effect.is(setDragFreeze)) return effect.value;
    }
    return value;
  },
});

const releaseFreeze = (view: EditorView): void => {
  if (!view.state.field(dragFreezeField)) return;
  // Re-asserting the selection makes the release a selection transaction, so
  // the hide/fold fields rebuild exactly once with the settled selection.
  view.dispatch({
    effects: setDragFreeze.of(false),
    selection: view.state.selection,
  });
};

const dragFreezePointerPlugin = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      this.view.contentDOM.addEventListener("pointerdown", this.onPointerDown);
      // Window-level release: a drag routinely ends outside the editor.
      window.addEventListener("pointerup", this.onPointerRelease);
      window.addEventListener("pointercancel", this.onPointerRelease);
    }

    onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return;
      if (this.view.state.field(dragFreezeField)) return;
      this.view.dispatch({ effects: setDragFreeze.of(true) });
    };

    onPointerRelease = (): void => {
      releaseFreeze(this.view);
    };

    destroy(): void {
      this.view.contentDOM.removeEventListener("pointerdown", this.onPointerDown);
      window.removeEventListener("pointerup", this.onPointerRelease);
      window.removeEventListener("pointercancel", this.onPointerRelease);
    }
  },
);

/**
 * Freezes the hide/fold decorations while a pointer drag is selecting text, so
 * marks do not flicker in and out under the moving selection head. Pointerdown
 * arms the freeze, every selection-only rebuild is deferred through the
 * vendored cores' filter seam, and pointerup releases with a selection nudge.
 */
export const dragFreezeExtension: Extension = [
  dragFreezeField,
  selectionRebuildFilter.of((tr) => !(tr.state.field(dragFreezeField, false) ?? false)),
  dragFreezePointerPlugin,
];
