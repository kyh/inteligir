// ---------------------------------------------------------------------------
// Pure state machine reducer — zero imports from Electron or agent layer.
// (state, event) → { next, effect } | null
// ---------------------------------------------------------------------------

import type { AppState, MachineEvent } from "@/shared/app-state";

export type EffectTag = "LOGIN" | "SETUP" | "LOGOUT";

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

    case "RETRY": {
      if (state.phase !== "error") return null;
      switch (state.prev) {
        case "logging_in":
          return { next: { phase: "logging_in" }, effect: "LOGIN" };
        case "setting_up":
        case "ready":
          return { next: { phase: "setting_up" }, effect: "SETUP" };
        default:
          return null;
      }
    }

    // ---- Internal events (from effect runner / sidecar) ---------------------

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
