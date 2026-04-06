import type { AppState } from "./app-state";

// ---------------------------------------------------------------------------
// Session state (used internally by Agent class)
// ---------------------------------------------------------------------------

export type SessionStatus = "idle" | "busy" | "error" | "starting";

/** Derive display status from app state. Pure — no store dependency. */
export function getSessionStatus(appState: AppState): SessionStatus {
  if (appState.phase === "ready") return appState.agent === "busy" ? "busy" : "idle";
  if (appState.phase === "error") return "error";
  return "starting";
}

// ---------------------------------------------------------------------------
// Method params & results
// ---------------------------------------------------------------------------

export type SendMessageResult = { accepted: true };
export type SteerResult = { accepted: true };
export type InterruptResult = { interrupted: boolean };
