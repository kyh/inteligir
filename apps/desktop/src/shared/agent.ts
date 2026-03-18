// ---------------------------------------------------------------------------
// Session state (used internally by Agent class)
// ---------------------------------------------------------------------------

export type SessionStatus = "idle" | "busy" | "error" | "starting";

/** UI-only status that combines agent and voice session states for display purposes. */
export type DisplayStatus = SessionStatus | "listening" | "speaking";

// ---------------------------------------------------------------------------
// Method params & results
// ---------------------------------------------------------------------------

export type SendMessageResult = { accepted: true };
export type SteerResult = { accepted: true };
export type InterruptResult = { interrupted: boolean };
