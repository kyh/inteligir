import { forceParsing, syntaxTreeAvailable } from "@codemirror/language";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

// Parse a little past the viewport so a short scroll lands on decorated text.
const PARSE_OVERSHOOT = 4000;
const PARSE_BUDGET_MS = 150;
const DEFER_MS = 50;

/**
 * The hide/fold decorations are whole-document StateFields built from the
 * syntax tree, so scrolling into territory the background parser has not
 * reached yet shows undecorated raw markdown until it catches up. This healer
 * watches viewport changes and, when the tree does not cover the viewport,
 * defers a bounded `forceParsing` — deferred because parsing dispatches, which
 * is illegal mid-update.
 */
export const forceParseHealerExtension = ViewPlugin.fromClass(
  class {
    private pending = false;
    private destroyed = false;

    constructor(readonly view: EditorView) {
      this.schedule(view);
    }

    update(update: ViewUpdate): void {
      if (update.viewportChanged) this.schedule(update.view);
    }

    schedule(view: EditorView): void {
      const target = Math.min(view.state.doc.length, view.viewport.to + PARSE_OVERSHOOT);
      if (syntaxTreeAvailable(view.state, target)) return;
      if (this.pending) return;
      this.pending = true;
      setTimeout(() => {
        this.pending = false;
        if (this.destroyed) return;
        const retarget = Math.min(
          this.view.state.doc.length,
          this.view.viewport.to + PARSE_OVERSHOOT,
        );
        if (!syntaxTreeAvailable(this.view.state, retarget)) {
          forceParsing(this.view, retarget, PARSE_BUDGET_MS);
        }
      }, DEFER_MS);
    }

    destroy(): void {
      this.destroyed = true;
    }
  },
);
