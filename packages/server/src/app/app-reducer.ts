// ---------------------------------------------------------------------------
// Pure state machine reducer — zero imports from Electron or agent layer.
// (state, event) → { next, effect } | null
//
// App lifecycle only: starting → setting_up → ready, plus error/RETRY and the
// explicit RESET_APP_DATA full wipe. There is no login phase — a guest boots
// straight through SETUP to the workspace; provider/account auth are
// feature-level concerns outside this machine.
// ---------------------------------------------------------------------------

import type { AppState, MachineEvent } from "@repo/bridge/app-state";

export type EffectTag = "SETUP" | "RESET" | "NEW_SESSION";

export type ReducerResult = {
  next: AppState;
  effect: EffectTag | null;
};

/**
 * Pure transition function. Returns null if the event is invalid for the
 * current state (caller should ignore). Never throws.
 */
export function reduce(state: AppState, event: MachineEvent): ReducerResult | null {
  switch (event.type) {
    // ---- External events (from renderer) ------------------------------------

    case "SETUP":
      if (state.phase !== "starting") return null;
      return { next: { phase: "setting_up" }, effect: "SETUP" };

    case "RESET_APP_DATA":
      // The full ~/.inteligir wipe + re-setup — the ONLY full-teardown action
      // (provider disconnect and account sign-out are independent and touch
      // only their own storage). Re-runs setup in the same effect, so the app
      // lands back in the workspace as a fresh guest.
      if (state.phase !== "ready" && state.phase !== "error") return null;
      return { next: { phase: "setting_up" }, effect: "RESET" };

    case "NEW_SESSION":
      if (state.phase !== "ready" || state.agent !== "idle") return null;
      return { next: state, effect: "NEW_SESSION" };

    case "NEW_SESSION_OK":
      if (state.phase !== "ready") return null;
      return { next: state, effect: null };

    case "RETRY": {
      if (state.phase !== "error") return null;
      // A failed RESET retries the RESET itself: the failure may have landed
      // BEFORE the wipe (stopAgent/teardown threw), so re-running a plain
      // SETUP would silently keep the data the user asked to destroy. The
      // wipe + re-seed are both idempotent, so re-running the whole effect is
      // safe whichever half died.
      if (state.prev === "resetting") {
        return { next: { phase: "setting_up" }, effect: "RESET" };
      }
      // The other error flavors retry through SETUP: a failed setup re-runs
      // it (seeding is idempotent), and a dead-agent error restarts the agent
      // the same way.
      return { next: { phase: "setting_up" }, effect: "SETUP" };
    }

    // ---- Internal events (from effect runner) ---------------------------------

    case "SETUP_OK":
      if (state.phase !== "setting_up") return null;
      return { next: { phase: "ready", agent: "idle" }, effect: null };

    case "SETUP_FAIL":
      if (state.phase !== "setting_up") return null;
      return {
        next: { phase: "error", prev: "setting_up", message: event.message },
        effect: null,
      };

    case "RESET_FAIL":
      // Same phase as a SETUP failure (a RESET runs through "setting_up"),
      // but the error records RESET provenance so RETRY re-runs the wipe —
      // a reset that failed must never masquerade as a setup that failed.
      if (state.phase !== "setting_up") return null;
      return {
        next: { phase: "error", prev: "resetting", message: event.message },
        effect: null,
      };

    case "NEW_SESSION_FAIL":
      // newSession = stopAgent + startAgent: a throw means the agent is gone,
      // so "ready" would be a lie. Error with prev "ready" routes RETRY to
      // SETUP, which restarts the agent.
      if (state.phase !== "ready") return null;
      return {
        next: { phase: "error", prev: "ready", message: event.message },
        effect: null,
      };

    case "AGENT_START":
      if (state.phase !== "ready") return null;
      return { next: { phase: "ready", agent: "busy" }, effect: null };

    case "AGENT_END":
      if (state.phase !== "ready") return null;
      return { next: { phase: "ready", agent: "idle" }, effect: null };

    default:
      return null;
  }
}
