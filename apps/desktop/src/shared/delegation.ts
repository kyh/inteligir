import { type Static, Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Delegation — one checkbox a user handed to a background agent. The agent does
// the task against the vault (./vault file tools + executor MCP), checks the
// box off, and appends a short result under it; the watcher then refreshes the
// editor. Status is tracked here purely so the UI can render an inline badge on
// the delegated line.
// ---------------------------------------------------------------------------

/** Content-addressed locator for the checkbox, computed main-side from the file.
 * `text` is the item text; `heading` is the nearest heading above it (or null),
 * which disambiguates duplicate item text across sections. */
const DelegationAnchorSchema = Type.Object(
  {
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
  },
  { additionalProperties: false },
);

export type Delegation = Static<typeof DelegationSchema>;

// ---------------------------------------------------------------------------
// IPC params/results
// ---------------------------------------------------------------------------

/** The renderer sends only the file + the checkbox text; main resolves the
 * line, its heading, and section context. */
export const CreateDelegationParamsSchema = Type.Object(
  {
    sourceFile: Type.String({ minLength: 1 }),
    text: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type CreateDelegationParams = Static<typeof CreateDelegationParamsSchema>;

export type CreateDelegationResult =
  | { ok: true; delegation: Delegation }
  | { ok: false; error: string };

export type ListDelegationsResult = { delegations: Delegation[] };
