// ---------------------------------------------------------------------------
// Vault-sync contract — the isomorphic shapes the Bridge/IPC registry, the host
// handlers, and the renderer settings UI all share. The sync ENGINE lives in
// @repo/core (pure reconcile) and its desktop adapters in server/sync/; this
// module is only the wire contract, so it stays node-free and loads in the
// renderer too.
//
// `SyncStatus` is @repo/core's — `@repo/core/sync/status` is the one
// definition every platform shares; consumers (renderer, host) import it from
// there directly. `SyncOutcome` mirrors @repo/core's engine outcome
// STRUCTURALLY (rather than importing it) so the desktop coordinator returns
// core's outcome and it assigns cleanly to this one.
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";

import type { SyncStatus } from "@repo/core/sync/status";

// ---------------------------------------------------------------------------
// Payload schemas (renderer → host) — validated at the handler boundary.
// ---------------------------------------------------------------------------

/** Partial config patch: omitting a field leaves it unchanged. */
export const SyncSetConfigSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    coordinatorUrl: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const SyncSignInSchema = Type.Object(
  {
    email: Type.String({ minLength: 1 }),
    password: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

/** Sign-up mirrors the sign-in shape — Better Auth derives the display name
 * from the email host-side, so no extra field crosses the wire. */
export const SyncSignUpSchema = Type.Object(
  {
    email: Type.String({ minLength: 1 }),
    password: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

/** Social sign-in INITIATION: names the provider to start OAuth against (must
 * be one the coordinator reports via account capabilities). The round-trip
 * completes in the system browser; capturing the resulting session on the
 * desktop is Phase 4 (deep-link callback). */
export const SyncSocialSignInSchema = Type.Object(
  { provider: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// Result / event shapes (host → renderer).
// ---------------------------------------------------------------------------

/** One unresolved conflict copy sitting in the vault — the sibling file that
 * preserved a conflict's losing bytes. An entry lives until the copy file is
 * deleted from the vault (deleting the copy IS resolving the conflict). */
export type SyncConflict = {
  /** Vault-relative path of the conflict COPY file (not the canonical note). */
  readonly path: string;
  /** ISO instant this device first noticed the copy (pass time or boot scan). */
  readonly detectedAt: string;
};

/** The reactive sync state surfaced to the renderer — the payload of both
 * `getSyncState` and the `onSyncStateChanged` event, so the UI subscribes once
 * and re-renders on every config / auth / status change. */
export type SyncState = {
  readonly enabled: boolean;
  readonly signedIn: boolean;
  readonly email: string | null;
  readonly coordinatorUrl: string;
  readonly status: SyncStatus;
  /** Unresolved conflict copies still present in the vault, oldest first. */
  readonly conflicts: readonly SyncConflict[];
};

export type SyncSignInResult = { ok: true } | { ok: false; error: string };

/** What the configured coordinator can serve the account UI — today just the
 * social providers whose buttons should render (env-gated server-side; an
 * unreachable/unset coordinator reports none). */
export type AccountCapabilities = {
  readonly socialProviders: readonly string[];
};
