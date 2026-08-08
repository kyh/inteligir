// ---------------------------------------------------------------------------
// What the agent's writes owe the user: a restore point behind the ordinary
// ones, and a confirmation in front of the destructive ones. Both are raised by
// the host inside the tool executor — the grant table (./agent-grants) declares
// WHICH tier a capability sits in; these are the shapes that tier crosses the
// wire as.
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";

/** A chat-agent edit/write on a vault note was checkpointed: the host copied
 * the pre-write bytes before the tool executed. Fired mid-turn; the client
 * collects them per turn (first capture per path = the pre-turn bytes) and
 * offers one undo toast when the turn settles. `create` = the write made a
 * new file, so undo deletes it. */
export type AgentEditCaptured = {
  id: string;
  path: string;
  kind: "edit" | "create";
  capturedAt: number;
};

export const RestoreAgentEditsSchema = Type.Object(
  { ids: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }) },
  { additionalProperties: false },
);

/** restoreAgentEdits verdict. Partial failures aggregate into one message —
 * whatever could be restored was. */
export type RestoreAgentEditsResult = { ok: true } | { ok: false; error: string };

/** A destructive action the agent has proposed, awaiting a human answer. The
 * host composes every field from its own state — a proposal never carries
 * model-authored prose, so a note's contents cannot write the dialog the user
 * is about to agree to. */
export type AgentConfirmationRequest = {
  id: string;
  /** The action and its target, as one question. */
  title: string;
  /** What confirming does, in the app's own words. */
  detail: string;
  confirmLabel: string;
};

export const AgentConfirmationReplySchema = Type.Object(
  { id: Type.String({ minLength: 1 }), confirmed: Type.Boolean() },
  { additionalProperties: false },
);
