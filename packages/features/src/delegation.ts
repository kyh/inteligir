import { type Static, Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Delegation — one checkbox a user handed to a background agent. The agent does
// the task against the vault (./vault file tools + executor MCP), checks the
// box off, and appends a short result under it; the watcher then refreshes the
// editor. Status is tracked here purely so the UI can render an inline badge on
// the delegated line.
// ---------------------------------------------------------------------------

/** Positional locator for the checkbox. `index` is its ordinal among ALL todo
 * checkboxes in the file (document order, checked or not) — identical in the
 * editor's parsed tree and the raw markdown, so it needs no text matching and
 * distinguishes duplicate labels. `text` + `heading` are resolved main-side from
 * that line, purely as context for the agent's prompt. */
const DelegationAnchorSchema = Type.Object(
  {
    index: Type.Number(),
    text: Type.String(),
    heading: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);

const DelegationStatusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("done"),
  Type.Literal("failed"),
]);

export const DelegationSchema = Type.Object(
  {
    id: Type.String(),
    /** Vault-relative path of the file the checkbox lives in. */
    sourceFile: Type.String(),
    anchor: DelegationAnchorSchema,
    /** The original `- [ ] …` line, for display. */
    lineText: Type.String(),
    status: DelegationStatusSchema,
    createdAt: Type.Number(),
    startedAt: Type.Union([Type.Number(), Type.Null()]),
    finishedAt: Type.Union([Type.Number(), Type.Null()]),
    /** One-line summary of what the agent did (status "done"). */
    resultSummary: Type.Union([Type.String(), Type.Null()]),
    /** Failure reason (status "failed"). */
    error: Type.Union([Type.String(), Type.Null()]),
    /** True once the host captured the file's pre-run bytes — the undo point
     * "Restore original" writes back. */
    hasSnapshot: Type.Boolean(),
    /** When the user last restored this delegation's snapshot (null = never). */
    restoredAt: Type.Union([Type.Number(), Type.Null()]),
  },
  { additionalProperties: false },
);

export type Delegation = Static<typeof DelegationSchema>;

// ---------------------------------------------------------------------------
// IPC params/results
// ---------------------------------------------------------------------------

/** The renderer sends the file + the checkbox's ordinal (its position among all
 * todo checkboxes in the document); main resolves the line, text + section. */
export const CreateDelegationParamsSchema = Type.Object(
  {
    sourceFile: Type.String({ minLength: 1 }),
    index: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type CreateDelegationParams = Static<typeof CreateDelegationParamsSchema>;

export type CreateDelegationResult =
  | { ok: true; delegation: Delegation }
  | { ok: false; error: string };

export type ListDelegationsResult = { delegations: Delegation[] };

/** Result of restoring a delegation's pre-run snapshot. A restore whose target
 * file already matches the snapshot bytes is a no-op success. */
export type RestoreSnapshotResult = { ok: true } | { ok: false; error: string };
