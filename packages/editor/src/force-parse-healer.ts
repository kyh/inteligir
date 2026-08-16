import { forceParsing, syntaxTreeAvailable } from "@codemirror/language";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

// Parse a little past the viewport so a short scroll lands on decorated text.
const PARSE_OVERSHOOT = 4000;
const PARSE_BUDGET_MS = 150;
const DEFER_MS = 50;
// One budget-exceeded pass on a huge document is expected; retry with backoff
// (50/100/200/400/800ms) instead of waiting for the next viewport change.
const MAX_ATTEMPTS = 5;

/**
 * The hide/fold decorations are whole-document StateFields built from the
 * syntax tree, so scrolling into territory the background parser has not
 * reached yet shows undecorated raw markdown until it catches up. This healer
 * watches viewport changes and, when the tree does not cover the viewport,
 * defers a bounded `forceParsing` — deferred because parsing dispatches, which
 * is illegal mid-update. A pass that exhausts its budget reschedules itself,
 * bounded, so healing never depends on another scroll.
 */
export const forceParseHealerExtension = ViewPlugin.fromClass(
  class {
    private pending = false;
    private destroyed = false;

    constructor(readonly view: EditorView) {
      this.schedule(0);
    }

    update(update: ViewUpdate): void {
      if (update.viewportChanged) this.schedule(0);
    }

    target(): number {
      return Math.min(this.view.state.doc.length, this.view.viewport.to + PARSE_OVERSHOOT);
    }

    schedule(attempt: number): void {
      if (this.pending) return;
      if (syntaxTreeAvailable(this.view.state, this.target())) return;
      this.pending = true;
      setTimeout(() => {
        this.pending = false;
        if (this.destroyed) return;
        const retarget = this.target();
        if (syntaxTreeAvailable(this.view.state, retarget)) return;
        const finished = forceParsing(this.view, retarget, PARSE_BUDGET_MS);
        if (!finished && attempt + 1 < MAX_ATTEMPTS) {
          this.schedule(attempt + 1);
        }
      }, DEFER_MS << attempt);
    }

    destroy(): void {
      this.destroyed = true;
    }
  },
);
