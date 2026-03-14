// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

export type SessionStatus = "idle" | "busy" | "error" | "starting";

export type SessionState = {
  status: SessionStatus;
  error: string | null;
};

// ---------------------------------------------------------------------------
// Method params & results
// ---------------------------------------------------------------------------

export type SendMessageResult = { accepted: true };
export type SteerResult = { accepted: true };
export type InterruptResult = { interrupted: boolean };
export type GetStateResult = SessionState;
