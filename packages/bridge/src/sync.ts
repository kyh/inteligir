// ---------------------------------------------------------------------------
// Account contract — the isomorphic shapes the Bridge/IPC registry, the host
// handlers, and the Account settings section all share. The account client
// itself (Better Auth over the configured server) is `@repo/sync`; this module
// is only the wire contract, so it stays node-free and loads in the UI too.
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";

/** The server URL an account belongs to. Per-install configuration: a
 * self-hoster points at their own Worker, so there is no fixed default. */
export const SetAccountServerUrlSchema = Type.Object(
  { serverUrl: Type.String() },
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
 * be one the server reports via account capabilities). The round-trip
 * completes in the system browser; the desktop captures the resulting session
 * through the `inteligir://session` deep link. */
export const SyncSocialSignInSchema = Type.Object(
  { provider: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

/** Password-reset REQUEST: asks the server to email a reset link.
 * The outcome is deliberately existence-blind — see the registry entry. */
export const SyncRequestPasswordResetSchema = Type.Object(
  { email: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

/** The reactive account state surfaced to the UI — the payload of both
 * `getAccountState` and the `onAccountStateChanged` event, so the Account
 * section subscribes once and re-renders on every config / auth change. */
export type AccountState = {
  readonly signedIn: boolean;
  readonly email: string | null;
  readonly serverUrl: string;
};

export type SyncSignInResult = { ok: true } | { ok: false; error: string };

/** What the configured server can serve the account UI — today just the
 * social providers whose buttons should render (env-gated server-side; an
 * unreachable/unset server reports none). */
export type AccountCapabilities = {
  readonly socialProviders: readonly string[];
};
