// ---------------------------------------------------------------------------
// The interactive chat thread's clock: when the current conversation began, and
// which turn is in flight. Two numbers the agent's mutating capabilities are
// scoped by — undo reaches only THIS conversation's captures, and delegation is
// budgeted per turn.
//
// Its own module rather than app-machine state because the reader is
// boot/agent-wiring.ts, which app-machine imports: a getter on the machine
// would be an import cycle. Nothing here is a singleton with resources — a
// reset would only mean "pretend a different conversation is open", which is
// exactly what a teardown must not do to a still-running one.
// ---------------------------------------------------------------------------

let sessionStartedAt = Date.now();
let turnSequence = 0;

/** A chat session started (fresh thread or a resumed one). The floor moves to
 * NOW either way: a resumed thread is the same conversation, but the process
 * that captured its earlier bytes is gone, so treating them as reachable would
 * be a claim we cannot check. Under-permissive by design — the tool's refusal
 * points the user at their own undo. */
export function markChatSessionStart(): void {
  sessionStartedAt = Date.now();
}

export function chatSessionStartedAt(): number {
  return sessionStartedAt;
}

/** A new interactive turn began. */
export function markChatTurnStart(): void {
  turnSequence += 1;
}

/** Changes exactly once per interactive turn — the only turn boundary the host
 * has. Callers compare it for INEQUALITY; the value itself means nothing. */
export function chatTurnSequence(): number {
  return turnSequence;
}
