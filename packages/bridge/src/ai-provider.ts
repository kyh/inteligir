// ---------------------------------------------------------------------------
// AI-provider contract — the isomorphic shapes the Bridge/IPC registry, the
// host handlers and the Settings → AI section share. The provider CATALOG and
// the credential handling are the host's (apps/web/src/worker/agent/*); this
// module is only the wire contract (selection + per-provider status), so it
// stays platform-free and loads in a client too. Credentials never cross this
// boundary: `connected` is a boolean, and the credential itself stays sealed in
// the host object.
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Payload schemas (renderer → host) — validated at the handler boundary.
// ---------------------------------------------------------------------------

/** Partial selection patch: omitting a field leaves it unchanged (switching
 * provider without a modelId moves to that provider's default model). */
export const AiProviderSetConfigSchema = Type.Object(
  {
    provider: Type.Optional(Type.String({ minLength: 1 })),
    modelId: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

/** Names one provider (connect / disconnect targets). */
export const AiProviderRefSchema = Type.Object(
  { provider: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// Result shapes (host → renderer).
// ---------------------------------------------------------------------------

export type AiProviderModel = {
  readonly id: string;
  readonly label: string;
};

export type AiProviderInfo = {
  readonly id: string;
  readonly label: string;
  /** False for providers that need no login (the dev faux provider). */
  readonly requiresAuth: boolean;
  /** Whether the host holds a live credential for this provider right now. */
  readonly connected: boolean;
  readonly defaultModelId: string;
  readonly models: readonly AiProviderModel[];
};

/** The payload of getAiProviderSettings and every mutating channel — the
 * Settings AI section renders exclusively from this snapshot. */
export type AiProviderSettings = {
  readonly selected: { readonly provider: string; readonly modelId: string };
  readonly providers: readonly AiProviderInfo[];
};

/**
 * What starting a connection answers with.
 *
 * `ok: true` means the authorization STARTED, never that it finished: the host
 * has no screen in common with its user, so it parks a PKCE verifier and hands
 * back the provider's consent URL for the client to send them to. The exchange
 * completes later, on the host's own OAuth callback, and reaches the client as
 * an `onAiProviderChanged` snapshot.
 *
 * `authorizeUrl` is therefore REQUIRED rather than optional — a caller that
 * receives `ok: true` and navigates nowhere has silently dropped the flow, and
 * the type is what stops that from typechecking.
 */
export type AiConnectResult = { ok: true; authorizeUrl: string } | { ok: false; error: string };
