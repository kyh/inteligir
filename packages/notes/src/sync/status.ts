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
  | {
      /** The deletion gate held the pass — nothing was applied and nothing
       * will be until a human confirms, so a surface showing this MUST offer
       * (or point at) that confirmation, never present it as progress. */
      readonly phase: "held";
      readonly deletions: number;
      readonly baseCount: number;
      readonly sample: readonly string[];
    }
  | { readonly phase: "error"; readonly message: string };

/** The held variant, so both apps narrow to one shared name. */
export type HeldSyncStatus = Extract<SyncStatus, { phase: "held" }>;

/** Project one completed pass's outcome to its status. The `syncing`/`idle`
 * phases are lifecycle states the caller sets around the pass — an outcome
 * only ever lands as `ok`, `held` or `error`. */
export function statusFromOutcome(outcome: SyncOutcome): SyncStatus {
  switch (outcome.status) {
    case "ok":
      return {
        phase: "ok",
        pushed: outcome.pushed,
        pulled: outcome.pulled,
        deleted: outcome.deleted,
        conflicts: outcome.conflicts,
        merged: outcome.merged,
      };
    case "held":
      return {
        phase: "held",
        deletions: outcome.deletions,
        baseCount: outcome.baseCount,
        sample: outcome.sample,
      };
    case "error":
      return { phase: "error", message: outcome.message };
  }
}
