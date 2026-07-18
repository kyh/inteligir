// ---------------------------------------------------------------------------
// AI-provider contract — the isomorphic shapes the Bridge/IPC registry, the
// host handlers, and the renderer Settings → AI section share. The provider
// CATALOG and credential handling live in server/provider/*; this module is
// only the wire contract (selection + per-provider status), so it stays
// node-free and loads in the renderer too. Credentials never cross this
// boundary: `connected` is a boolean, tokens stay in pi's on-device
// auth.json.
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
  /** Credentials cached on-device for this provider right now. */
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

export type AiConnectResult = { ok: true } | { ok: false; error: string };
