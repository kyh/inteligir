// ---------------------------------------------------------------------------
// Vault-sync contract — the isomorphic shapes the Bridge/IPC registry, the host
// handlers, and the renderer settings UI all share. The sync ENGINE lives in
// @repo/notes (pure reconcile) and its desktop adapters in @repo/sync/; this
// module is only the wire contract, so it stays node-free and loads in the
// renderer too.
//
// `SyncStatus` is @repo/notes's — `@repo/notes/sync/status` is the one
// definition every platform shares; consumers (renderer, host) import it from
// there directly. `SyncOutcome` mirrors @repo/notes's engine outcome
// STRUCTURALLY (rather than importing it) so the desktop coordinator returns
// core's outcome and it assigns cleanly to this one.
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";

import type { SyncStatus } from "@repo/notes/sync/status";
import type { DeviceRecord } from "@repo/notes/sync/wire";

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
 * completes in the system browser; the desktop captures the resulting session
 * through the `inteligir://session` deep link. */
export const SyncSocialSignInSchema = Type.Object(
  { provider: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

/** Force one reconcile pass. `confirmDeletions` carries the deletion COUNT the
 * user approved and waives the engine's deletion gate up to it, for THAT PASS
 * ONLY — never stored, so a renderer can only ever release the hold it is
 * currently showing, at the size it is showing. */
export const SyncNowSchema = Type.Object(
  { confirmDeletions: Type.Optional(Type.Integer({ minimum: 0 })) },
  { additionalProperties: false },
);

/** Password-reset REQUEST: asks the coordinator to email a reset link.
 * The outcome is deliberately existence-blind — see the registry entry. */
export const SyncRequestPasswordResetSchema = Type.Object(
  { email: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

/** Tombstone one enrolled device, named by its base64url public key (the
 * roster's primary key). Revoking THIS device is deliberately not expressible
 * here — see `SyncDeviceInfo`. */
export const SyncRevokeDeviceSchema = Type.Object(
  { publicKey: Type.String({ minLength: 1 }) },
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
};

/**
 * This install's sync device key, and the vault its public key FOUNDS. Present
 * only once the user has explicitly reconnected the vault to a device-owned
 * remote; absent means sync runs on the account credential instead.
 *
 * There is no "revoke this device" in the client vocabulary and there must not
 * be one: the coordinator refuses the revoke that would leave a vault with no
 * live key, because it cannot tell "I am leaving" from "strand this vault".
 * Leaving is `disconnectSyncVault` — local, and never a server call.
 */
export type SyncDeviceInfo = {
  /** base64url of the raw Ed25519 public key — this device's roster id. */
  readonly publicKey: string;
  /** `v1` + base32(sha256(publicKey)) — the vault this key founds. */
  readonly vaultId: string;
  /** Epoch ms the key was generated. */
  readonly foundedAt: number;
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
  /** This install's device key, or null when sync runs on the account. */
  readonly device: SyncDeviceInfo | null;
};

/** `getSyncDevices` — the coordinator's roster. A failure is a value: the
 * roster is a network read the settings panel renders inline, not a throw. */
export type SyncDeviceListResult =
  | { readonly ok: true; readonly devices: readonly DeviceRecord[] }
  | { readonly ok: false; readonly error: string };

/** A minted pairing offer: the blob to paste into the joining device, and when
 * it stops being redeemable. The blob is a LIVE CAPABILITY until then — show
 * it, don't store it. */
export type SyncPairingOffer = {
  /** The pasteable token (`@repo/notes/sync/wire`'s pairing blob). */
  readonly blob: string;
  /** Epoch ms the coordinator will stop honoring it. */
  readonly expiresAt: number;
};

export type SyncPairingOfferResult =
  | { readonly ok: true; readonly offer: SyncPairingOffer }
  | { readonly ok: false; readonly error: string };

/**
 * `revokeSyncDevice`'s verdict. `last-device` is a REFUSAL the coordinator
 * makes, not a transport failure: a vault whose last key is tombstoned can
 * neither authenticate nor enroll again, so the client offers "disconnect this
 * vault" instead — the local path.
 */
export type SyncRevokeDeviceResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "not-found" | "last-device" | "failed";
      readonly error: string;
    };

/** `reconnectSyncVault`'s verdict — founding a device vault and re-pointing
 * sync at it. `ok` means the key exists and sync is live against the new
 * vaultId; the first pass (a full upload) reports through `onSyncStateChanged`
 * like any other. */
export type SyncReconnectResult =
  | { readonly ok: true; readonly device: SyncDeviceInfo }
  | { readonly ok: false; readonly error: string };

export type SyncSignInResult = { ok: true } | { ok: false; error: string };

/** What the configured coordinator can serve the account UI — today just the
 * social providers whose buttons should render (env-gated server-side; an
 * unreachable/unset coordinator reports none). */
export type AccountCapabilities = {
  readonly socialProviders: readonly string[];
};
