// ---------------------------------------------------------------------------
// App lifecycle state machine types
// ---------------------------------------------------------------------------

export type AppState =
  | { phase: "logged_out" }
  | { phase: "logging_in" }
  | { phase: "logged_in" }
  | { phase: "setting_up" }
  | { phase: "ready"; agent: "idle" | "busy" }
  | { phase: "logging_out" }
  | { phase: "error"; prev: "logging_in" | "setting_up" | "ready"; message: string };

export type AppEvent =
  | { type: "LOGIN" }
  | { type: "SETUP" }
  | { type: "LOGOUT" }
  | { type: "RETRY" };
