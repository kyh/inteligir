// ---------------------------------------------------------------------------
// Session state (used internally by Agent class)
// ---------------------------------------------------------------------------

export type SessionStatus = "idle" | "busy" | "error" | "starting";

// ---------------------------------------------------------------------------
// Method params & results
// ---------------------------------------------------------------------------

export type SendMessageResult = { accepted: true };
export type SteerResult = { accepted: true };
export type InterruptResult = { interrupted: boolean };
