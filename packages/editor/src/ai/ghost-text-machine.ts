// Ghost-text state machine — the editor-independent core of the copilot
// surface, extracted so every cancellation edge (type/escape/blur/stale
// response) is unit-testable with fake hooks. The kit (ghost-text-kit.tsx)
// wires it to Plate ops, the Bridge, and the plugin's render state.
//
//   idle → (doc change) → scheduled → (debounce fires, conditions hold)
//        → requesting → (completion lands, still current) → visible
//
// Any input dismisses a visible ghost and cancels a pending request; doc
// changes reschedule (typing pause re-arms the trigger), caret-only moves
// don't (clicking around must not spend tokens).

import type { GhostTextResult } from "@repo/bridge/inline-ai";

export type GhostPhase = "idle" | "scheduled" | "requesting" | "visible";

export type GhostHooks = {
  /** Debounced scheduling; returns a cancel. */
  schedule: (fn: () => void, ms: number) => () => void;
  /** All editor-side trigger conditions (caret at block end, no code block /
   * frontmatter / combobox / AI session / transient marks, focused …). */
  canTrigger: () => boolean;
  /** Prompt for the current caret block; null aborts the trigger. */
  getPrompt: () => string | null;
  request: (prompt: string, requestId: string) => Promise<GhostTextResult>;
  cancelRequest: (requestId: string) => void;
  /** Render the ghost at the caret block. */
  show: (text: string) => void;
  /** Remove the rendered ghost. */
  hide: () => void;
  /** Accept: insert the ghost text at the caret. */
  insert: (text: string) => void;
};

// Unique across machine instances so a recreated machine (settings toggle)
// can't cancel or adopt its predecessor's host-side request.
let instanceCounter = 0;

export class GhostTextMachine {
  private phase: GhostPhase = "idle";
  private seq = 0;
  private text: string | null = null;
  private cancelTimer: (() => void) | null = null;
  private readonly instance: number;

  constructor(
    private readonly hooks: GhostHooks,
    private readonly debounceMs: number,
  ) {
    instanceCounter += 1;
    this.instance = instanceCounter;
  }

  getPhase(): GhostPhase {
    return this.phase;
  }

  /** A content op happened: dismiss, cancel, and re-arm the debounce. */
  onDocChange(): void {
    this.dismiss();
    this.cancelInFlight();
    this.cancelTimer?.();
    this.phase = "scheduled";
    this.cancelTimer = this.hooks.schedule(() => this.fire(), this.debounceMs);
  }

  /** Caret moved without a content change: dismiss and stand down. */
  onCaretMove(): void {
    this.dismiss();
    this.reset();
  }

  /** Escape: returns true (consume the key) only when a ghost was visible. */
  onEscape(): boolean {
    const wasVisible = this.phase === "visible";
    this.dismiss();
    this.reset();
    return wasVisible;
  }

  /** Tab: accept the visible ghost. Returns true when consumed. */
  onTab(): boolean {
    if (this.phase !== "visible" || this.text === null) return false;
    const text = this.text;
    // insert() triggers onDocChange (dismiss + reschedule) via the editor op.
    this.hooks.insert(text);
    return true;
  }

  onBlur(): void {
    this.dismiss();
    this.reset();
  }

  dispose(): void {
    this.dismiss();
    this.reset();
  }

  private fire(): void {
    this.cancelTimer = null;
    if (!this.hooks.canTrigger()) {
      this.phase = "idle";
      return;
    }
    const prompt = this.hooks.getPrompt();
    if (prompt === null || prompt.length === 0) {
      this.phase = "idle";
      return;
    }
    this.seq += 1;
    const seq = this.seq;
    this.phase = "requesting";
    this.hooks
      .request(prompt, this.requestId(seq))
      .then((result) => {
        if (this.seq !== seq || this.phase !== "requesting") return; // stale
        if (!result.ok || result.text.length === 0 || result.text === "0") {
          this.phase = "idle";
          return;
        }
        this.text = result.text;
        this.phase = "visible";
        this.hooks.show(result.text);
        return undefined;
      })
      .catch(() => {
        if (this.seq === seq && this.phase === "requesting") this.phase = "idle";
      });
  }

  private dismiss(): void {
    if (this.phase !== "visible") return;
    this.text = null;
    this.hooks.hide();
  }

  private cancelInFlight(): void {
    if (this.phase !== "requesting") return;
    this.hooks.cancelRequest(this.requestId(this.seq));
    this.seq += 1; // orphan the in-flight response
    this.phase = "idle";
  }

  /** Cancel timer + in-flight request; back to idle. */
  private reset(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.cancelInFlight();
    this.phase = "idle";
    this.text = null;
  }

  private requestId(seq: number): string {
    return `ghost-${this.instance}-${seq}`;
  }
}
