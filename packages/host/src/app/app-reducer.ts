// ---------------------------------------------------------------------------
// Pure state machine reducer — zero imports from Electron or agent layer.
// (state, event) → { next, effect } | null
// ---------------------------------------------------------------------------

import type { AppState, MachineEvent } from "@repo/core/app-state";

export type EffectTag = "LOGIN" | "SETUP" | "LOGOUT" | "NEW_SESSION";

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

    case "LOGIN":
      if (state.phase !== "logged_out") return null;
      return { next: { phase: "logging_in" }, effect: "LOGIN" };

    case "SETUP":
      if (state.phase !== "logged_in") return null;
      return { next: { phase: "setting_up" }, effect: "SETUP" };

    case "LOGOUT":
      if (state.phase !== "ready" && state.phase !== "error") return null;
      return { next: { phase: "logging_out" }, effect: "LOGOUT" };

    case "NEW_SESSION":
      if (state.phase !== "ready" || state.agent !== "idle") return null;
      return { next: state, effect: "NEW_SESSION" };

    case "NEW_SESSION_OK":
      if (state.phase !== "ready") return null;
      return { next: state, effect: null };

    case "RETRY": {
      if (state.phase !== "error") return null;
      switch (state.prev) {
        case "logging_in":
          return { next: { phase: "logging_in" }, effect: "LOGIN" };
        case "setting_up":
        case "ready":
          return { next: { phase: "setting_up" }, effect: "SETUP" };
        case "logging_out":
          return { next: { phase: "logging_out" }, effect: "LOGOUT" };
        default:
          return null;
      }
    }

    // ---- Internal events (from effect runner) ---------------------------------

    case "LOGIN_OK":
      if (state.phase !== "logging_in") return null;
      return { next: { phase: "logged_in" }, effect: null };

    case "LOGIN_FAIL":
      if (state.phase !== "logging_in") return null;
      return {
        next: { phase: "error", prev: "logging_in", message: event.message },
        effect: null,
      };

    case "SETUP_OK":
      if (state.phase !== "setting_up") return null;
      return { next: { phase: "ready", agent: "idle" }, effect: null };

    case "SETUP_FAIL":
      if (state.phase !== "setting_up") return null;
      return {
        next: { phase: "error", prev: "setting_up", message: event.message },
        effect: null,
      };

    case "LOGOUT_OK":
      if (state.phase !== "logging_out") return null;
      return { next: { phase: "logged_out" }, effect: null };

    case "LOGOUT_FAIL":
      // A wedged "logging_out" would absorb every further event; surface the
      // failure instead so RETRY (→ LOGOUT) and LOGOUT both stay available.
      if (state.phase !== "logging_out") return null;
      return {
        next: { phase: "error", prev: "logging_out", message: event.message },
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
