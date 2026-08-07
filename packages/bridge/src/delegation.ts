import { type Static, Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Delegation — one checkbox a user handed to a background agent. The agent does
// the task against its materialized copy of the vault, checks the box off, and
// appends a short result under it; the write lands back in the vault of record
// and onVaultChanged refreshes the editor. Status is tracked here purely so the
// UI can render an inline badge on the delegated line.
// ---------------------------------------------------------------------------

/** Positional locator for the checkbox. `ordinal` is its position among ALL
 * todo checkboxes in the file (document order, checked or not — core
 * scanTaskItems' counting) — identical in the editor's parsed tree and the raw
 * markdown, so it needs no text matching and distinguishes duplicate labels.
 * `text` + `heading` are resolved host-side from that line, purely as context
 * for the agent's prompt. */
const DelegationAnchorSchema = Type.Object(
  {
    ordinal: Type.Number(),
    text: Type.String(),
    heading: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);

/** Fields every delegation carries regardless of status. */
const delegationBaseFields = {
  id: Type.String(),
  /** Vault-relative path of the file the checkbox lives in. */
  sourceFile: Type.String(),
  anchor: DelegationAnchorSchema,
  /** The original `- [ ] …` line, for display. */
  lineText: Type.String(),
};

// A discriminated union on `status` — the status-correlated fields (the
// timestamps, resultSummary, error, snapshot bookkeeping) are typed per
// variant instead of documented in comments, so an illegal combination (a
// queued record with a finishedAt, a done record with an error) cannot be
// constructed. Every variant still SERIALIZES the same field set — absent
// states are explicit nulls — so union modeling alone never changed the
// on-disk shape (the anchor's index→ordinal rename did: store v4).
export const DelegationSchema = Type.Union([
  // Created, waiting for the background agent. No run has touched it.
  Type.Object(
    {
      ...delegationBaseFields,
      status: Type.Literal("queued"),
      createdAt: Type.Number(),
      startedAt: Type.Null(),
      finishedAt: Type.Null(),
      resultSummary: Type.Null(),
      error: Type.Null(),
      hasSnapshot: Type.Literal(false),
      restoredAt: Type.Null(),
    },
    { additionalProperties: false },
  ),
  // Dispatched to the agent. `hasSnapshot` flips true once the pre-run bytes
  // are captured (immediately after dispatch, before the agent may write).
  Type.Object(
    {
      ...delegationBaseFields,
      status: Type.Literal("running"),
      createdAt: Type.Number(),
      startedAt: Type.Number(),
      finishedAt: Type.Null(),
      resultSummary: Type.Null(),
      error: Type.Null(),
      hasSnapshot: Type.Boolean(),
      restoredAt: Type.Null(),
    },
    { additionalProperties: false },
  ),
  // The run finished. `resultSummary` is the agent's one-line outcome.
  Type.Object(
    {
      ...delegationBaseFields,
      status: Type.Literal("done"),
      createdAt: Type.Number(),
      startedAt: Type.Number(),
      finishedAt: Type.Number(),
      resultSummary: Type.String(),
      error: Type.Null(),
      /** True while the host still holds the file's pre-run bytes — the undo
       * point "Restore original" writes back (prune clears it). */
      hasSnapshot: Type.Boolean(),
      /** When the user last restored this delegation's snapshot (null = never). */
      restoredAt: Type.Union([Type.Number(), Type.Null()]),
    },
    { additionalProperties: false },
  ),
  // Terminal failure (interrupt, unavailable, timeout, error, stale anchor).
  // `startedAt` stays null when it failed straight out of the queue.
  Type.Object(
    {
      ...delegationBaseFields,
      status: Type.Literal("failed"),
      createdAt: Type.Number(),
      startedAt: Type.Union([Type.Number(), Type.Null()]),
      finishedAt: Type.Number(),
      resultSummary: Type.Null(),
      /** Failure reason, for the inline badge / dock card. */
      error: Type.String(),
      hasSnapshot: Type.Boolean(),
      restoredAt: Type.Union([Type.Number(), Type.Null()]),
    },
    { additionalProperties: false },
  ),
]);

export type Delegation = Static<typeof DelegationSchema>;

// ---------------------------------------------------------------------------
// IPC params/results
// ---------------------------------------------------------------------------

/** The renderer sends the file + the checkbox's ordinal (its position among all
 * todo checkboxes in the document); main resolves the line, text + section. */
export const CreateDelegationParamsSchema = Type.Object(
  {
    sourceFile: Type.String({ minLength: 1 }),
    ordinal: Type.Number({ minimum: 0 }),
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
