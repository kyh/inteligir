import type { SyncOutcome } from "./engine";

// ---------------------------------------------------------------------------
// SyncStatus — the UI-facing lifecycle of the most recent sync pass: idle
// before any pass, syncing while one runs, then the outcome of the last
// completed pass. The ONE definition every surface shares (desktop settings,
// mobile vault screen, the Bridge wire contract) — `statusFromOutcome` is the
// single projection from the engine's `SyncOutcome`, so a pass renders
// identically on every platform.
// ---------------------------------------------------------------------------

export type SyncStatus =
  | { readonly phase: "idle" }
  | { readonly phase: "syncing" }
  | {
      readonly phase: "ok";
      readonly pushed: number;
      readonly pulled: number;
      readonly deleted: number;
      readonly conflicts: number;
      /** Both-sides-changed files the merge ladder resolved cleanly — never
       * counted in `conflicts`, never listed as conflict rows. */
      readonly merged: number;
    }
  | { readonly phase: "error"; readonly message: string };

/** Project one completed pass's outcome to its status. The `syncing`/`idle`
 * phases are lifecycle states the caller sets around the pass — an outcome
 * only ever lands as `ok` or `error`. */
export function statusFromOutcome(outcome: SyncOutcome): SyncStatus {
  return outcome.status === "ok"
    ? {
        phase: "ok",
        pushed: outcome.pushed,
        pulled: outcome.pulled,
        deleted: outcome.deleted,
        conflicts: outcome.conflicts,
        merged: outcome.merged,
      }
    : { phase: "error", message: outcome.message };
}
