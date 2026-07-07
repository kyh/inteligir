// ---------------------------------------------------------------------------
// Vault-sync contract — the isomorphic shapes the Bridge/IPC registry, the host
// handlers, and the renderer settings UI all share. The sync ENGINE lives in
// @repo/core (pure reconcile) and its desktop adapters in server/sync/; this
// module is only the wire contract, so it stays node-free and loads in the
// renderer too.
//
// `SyncOutcome` mirrors @repo/core's engine outcome STRUCTURALLY (rather than
// importing it) so the renderer never has to reach into @repo/core: the desktop
// coordinator returns core's outcome and it assigns cleanly to this one.
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";

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

// ---------------------------------------------------------------------------
// Result / event shapes (host → renderer).
// ---------------------------------------------------------------------------

/** The most recent pass's status for the settings UI: idle before any pass,
 * syncing while one runs, then the outcome of the last completed pass. */
export type SyncStatus =
  | { readonly phase: "idle" }
  | { readonly phase: "syncing" }
  | {
      readonly phase: "ok";
      readonly pushed: number;
      readonly pulled: number;
      readonly deleted: number;
      readonly conflicts: number;
    }
  | { readonly phase: "error"; readonly message: string };

/** The reactive sync state surfaced to the renderer — the payload of both
 * `getSyncState` and the `onSyncStateChanged` event, so the UI subscribes once
 * and re-renders on every config / auth / status change. */
export type SyncState = {
  readonly enabled: boolean;
  readonly signedIn: boolean;
  readonly email: string | null;
  readonly coordinatorUrl: string;
  readonly status: SyncStatus;
};

/** One reconcile pass's result. Structurally identical to @repo/core's
 * `SyncOutcome` (engine.ts) so the coordinator can return it directly. */
export type SyncOutcome =
  | {
      readonly status: "ok";
      readonly pushed: number;
      readonly pulled: number;
      readonly deleted: number;
      readonly conflicts: number;
    }
  | { readonly status: "error"; readonly message: string };

export type SyncSignInResult = { ok: true } | { ok: false; error: string };
