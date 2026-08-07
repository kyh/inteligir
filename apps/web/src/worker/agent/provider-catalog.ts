// ---------------------------------------------------------------------------
// The AI providers this deployment can put in front of a user.
//
// Two halves, configured differently on purpose.
//
// The API half — host, base URL, auth header — is a CONSTANT. It is what the
// egress interceptor keys on (./egress), so a deployment that could reconfigure
// it could point the credential at a host of its choosing, and the whole point
// of holding the token in the Durable Object is that only one host ever sees
// it.
//
// The OAUTH half — authorize URL, token URL, client id — is per-deployment
// SECRETS, and a provider is offered only when all three are set. Same
// both-or-nothing gate as the social sign-in providers (auth/auth.ts), and for
// the same reason: an OAuth client belongs to whoever registered it, so a
// deployment nobody configured must offer nothing rather than a button that
// dead-ends. Registering those apps is owner-only work (see apps/web/README.md).
//
// `sandbox` is the third entry and it needs no credential at all. It is the
// cloud twin of the desktop's faux provider: it exists so a chat turn, a tool
// call and a vault write can be driven end to end with no provider account and
// no container — the fake sandbox port answers it (./fake-sandbox). It is
// offered only where there is no real Sandbox binding, so a provisioned
// deployment never shows it.
// ---------------------------------------------------------------------------

import type { AiProviderInfo, AiProviderModel } from "@repo/bridge/ai-provider";

/** How a provider expects its bearer to be presented on an API request. */
type ProviderAuthStyle =
  /** `Authorization: Bearer <token>` */
  | { readonly header: "authorization"; readonly prefix: "Bearer " }
  /** `x-api-key: <token>` — Anthropic's own scheme for direct API keys. */
  | { readonly header: "x-api-key"; readonly prefix: "" };

/** Which HTTP shape this provider's completion API speaks. The Worker calls it
 * directly for the editor's no-tools turns (../ai/provider-wire), so the format
 * has to be a declared fact rather than something inferred from a model id. */
type ProviderWire = "anthropic" | "openai";

export type ProviderEntry = {
  readonly id: string;
  readonly label: string;
  /** The single hostname this provider's traffic leaves the container on. The
   * egress allowlist and the interceptor are both keyed on it. */
  readonly apiHost: string;
  /** Base URL the container's pi runtime is pointed at. */
  readonly baseUrl: string;
  readonly wire: ProviderWire;
  readonly auth: ProviderAuthStyle;
  /** Extra headers the provider requires on every request, injected alongside
   * the credential so the container never has to know them. */
  readonly extraHeaders: Readonly<Record<string, string>>;
  readonly defaultModelId: string;
  /**
   * The model the latency-sensitive editor surfaces run on — ghost text, and
   * the AI menu's intent classification.
   *
   * DECLARED per provider rather than derived from a price list: the desktop
   * picked the cheapest model in pi's registry by output cost, and this catalog
   * carries no cost column, so a derivation here would be a guess dressed as a
   * rule. Naming it is one line per provider and cannot be wrong.
   */
  readonly fastModelId: string;
  readonly models: readonly AiProviderModel[];
  /** OAuth scopes requested at authorize time. */
  readonly scopes: readonly string[];
  /** False only for `sandbox`, which has nothing to connect to. */
  readonly requiresAuth: boolean;
};

/** The provider the fake sandbox answers. No account, no container, no token. */
export const SANDBOX_PROVIDER_ID = "sandbox";

const ANTHROPIC: ProviderEntry = {
  id: "anthropic",
  label: "Claude",
  apiHost: "api.anthropic.com",
  baseUrl: "https://api.anthropic.com/v1",
  wire: "anthropic",
  auth: { header: "authorization", prefix: "Bearer " },
  // Anthropic rejects a request with no API version, and the version is a
  // property of the wire contract this Worker speaks — not of the image.
  extraHeaders: { "anthropic-version": "2023-06-01" },
  defaultModelId: "claude-sonnet-5",
  fastModelId: "claude-haiku-5",
  models: [
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-opus-5", label: "Claude Opus 5" },
    { id: "claude-haiku-5", label: "Claude Haiku 5" },
  ],
  scopes: ["user:inference"],
  requiresAuth: true,
};

const OPENAI: ProviderEntry = {
  id: "openai",
  label: "OpenAI",
  apiHost: "api.openai.com",
  baseUrl: "https://api.openai.com/v1",
  wire: "openai",
  auth: { header: "authorization", prefix: "Bearer " },
  extraHeaders: {},
  defaultModelId: "gpt-5.5",
  fastModelId: "gpt-5.5-mini",
  models: [
    { id: "gpt-5.5", label: "GPT-5.5" },
    { id: "gpt-5.5-mini", label: "GPT-5.5 mini" },
  ],
  scopes: ["api.request"],
  requiresAuth: true,
};

const SANDBOX: ProviderEntry = {
  id: SANDBOX_PROVIDER_ID,
  label: "Sandbox (no account)",
  // Never dialed: the fake sandbox produces its turns locally. Named anyway so
  // every entry has one shape and no code branches on a missing host.
  apiHost: "sandbox.invalid",
  baseUrl: "https://sandbox.invalid/v1",
  wire: "openai",
  auth: { header: "authorization", prefix: "Bearer " },
  extraHeaders: {},
  defaultModelId: "sandbox-1",
  fastModelId: "sandbox-1",
  models: [{ id: "sandbox-1", label: "Scripted" }],
  scopes: [],
  requiresAuth: false,
};

const ALL: readonly ProviderEntry[] = [ANTHROPIC, OPENAI, SANDBOX];

/** The provider entry for `id`, or `null` when nothing declares it. */
export function providerEntry(id: string): ProviderEntry | null {
  return ALL.find((entry) => entry.id === id) ?? null;
}

/** Every provider entry, whether or not this deployment can offer it — the
 * egress allowlist is built from this, because a host must be reachable before
 * the credential that authorizes it can be checked. */
export function allProviders(): readonly ProviderEntry[] {
  return ALL;
}

/**
 * The env members this module reads.
 *
 * Narrower than `Env` on purpose, the way `host/origins.ts` narrows its own:
 * a test can then state the configuration it is testing, instead of "nothing is
 * configured" quietly meaning "nothing is in the developer's .dev.vars". Every
 * member is explicitly `| undefined` so an unset one can be WRITTEN as unset
 * under `exactOptionalPropertyTypes`.
 */
export type ProviderEnv = {
  readonly AGENT_RUNTIME?: string | undefined;
  readonly ANTHROPIC_OAUTH_AUTHORIZE_URL?: string | undefined;
  readonly ANTHROPIC_OAUTH_TOKEN_URL?: string | undefined;
  readonly ANTHROPIC_OAUTH_CLIENT_ID?: string | undefined;
  readonly ANTHROPIC_OAUTH_CLIENT_SECRET?: string | undefined;
  readonly OPENAI_OAUTH_AUTHORIZE_URL?: string | undefined;
  readonly OPENAI_OAUTH_TOKEN_URL?: string | undefined;
  readonly OPENAI_OAUTH_CLIENT_ID?: string | undefined;
  readonly OPENAI_OAUTH_CLIENT_SECRET?: string | undefined;
};

/** One provider's OAuth app, as this deployment configured it. */
export type ProviderOAuthApp = {
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly clientId: string;
};

/**
 * The OAuth app configured for `id`, or `null` when this deployment has none.
 *
 * Read per call rather than cached: `Env` is per-request on workerd, and a
 * cached copy in module scope would be one deployment's configuration serving
 * another's isolate. Spelled out per provider rather than computed from the id
 * because `Env` has no index signature — and a lookup that cannot be spelled is
 * a variable nobody declared.
 */
export function providerOAuthApp(env: ProviderEnv, id: string): ProviderOAuthApp | null {
  const trio =
    id === ANTHROPIC.id
      ? {
          authorizeUrl: env.ANTHROPIC_OAUTH_AUTHORIZE_URL,
          tokenUrl: env.ANTHROPIC_OAUTH_TOKEN_URL,
          clientId: env.ANTHROPIC_OAUTH_CLIENT_ID,
        }
      : id === OPENAI.id
        ? {
            authorizeUrl: env.OPENAI_OAUTH_AUTHORIZE_URL,
            tokenUrl: env.OPENAI_OAUTH_TOKEN_URL,
            clientId: env.OPENAI_OAUTH_CLIENT_ID,
          }
        : null;
  if (trio === null) return null;
  const { authorizeUrl, tokenUrl, clientId } = trio;
  if (
    authorizeUrl === undefined ||
    tokenUrl === undefined ||
    clientId === undefined ||
    authorizeUrl === "" ||
    tokenUrl === "" ||
    clientId === ""
  ) {
    return null;
  }
  return { authorizeUrl, tokenUrl, clientId };
}

/** The optional client secret for `id`. Absent is normal: a public client uses
 * PKCE alone, and sending an empty secret is worse than sending none. */
export function providerOAuthSecret(env: ProviderEnv, id: string): string | null {
  const value =
    id === ANTHROPIC.id
      ? env.ANTHROPIC_OAUTH_CLIENT_SECRET
      : id === OPENAI.id
        ? env.OPENAI_OAUTH_CLIENT_SECRET
        : undefined;
  return value !== undefined && value !== "" ? value : null;
}

/** Whether this deployment runs the agent in a real Cloudflare Sandbox. The
 * alternative is the scripted in-memory one (./fake-sandbox), which is what a
 * deployment with no Workers Paid plan — and every test — runs. */
export function sandboxRuntimeEnabled(env: ProviderEnv): boolean {
  return env.AGENT_RUNTIME !== "scripted";
}

/**
 * Whether this deployment can offer `entry` at all: a real provider needs its
 * OAuth app configured, and `sandbox` exists only where the real runtime does
 * not — offering a scripted agent beside a real one would be a menu entry
 * nobody could tell apart from a broken provider.
 */
function providerOffered(env: ProviderEnv, entry: ProviderEntry): boolean {
  if (!entry.requiresAuth) return !sandboxRuntimeEnabled(env);
  return providerOAuthApp(env, entry.id) !== null;
}

/** The providers this deployment offers, in menu order. */
export function offeredProviders(env: ProviderEnv): readonly ProviderEntry[] {
  return ALL.filter((entry) => providerOffered(env, entry));
}

/** Project one entry into the Settings wire shape. */
export function providerInfo(entry: ProviderEntry, connected: boolean): AiProviderInfo {
  return {
    id: entry.id,
    label: entry.label,
    requiresAuth: entry.requiresAuth,
    connected,
    defaultModelId: entry.defaultModelId,
    models: entry.models,
  };
}

/** The model id to run `entry` on, given a stored selection that may name a
 * model the catalog has since dropped. */
export function resolveModelId(entry: ProviderEntry, requested: string | undefined): string {
  if (requested !== undefined && entry.models.some((model) => model.id === requested)) {
    return requested;
  }
  return entry.defaultModelId;
}

/**
 * The provider entry a stored selection resolves to, defaulting to the first
 * one this deployment offers. `null` only when it offers none.
 *
 * ONE resolution for every reader, and that is the point rather than a tidiness
 * preference: Settings renders what this answers, and a turn runs what this
 * answers. Two defaults for the same question is a fresh account being SHOWN a
 * selected provider and then told none is selected when it sends a message.
 *
 * Normalized on READ rather than written back: a stored selection naming a
 * provider this deployment stopped offering is a configuration change, not a
 * user action, and overwriting their choice would lose it if the configuration
 * came back.
 */
function effectiveProvider(
  env: ProviderEnv,
  stored: { readonly provider: string; readonly modelId: string } | null,
): ProviderEntry | null {
  const offered = offeredProviders(env);
  const chosen = stored === null ? null : offered.find((entry) => entry.id === stored.provider);
  return chosen ?? offered[0] ?? null;
}

/** That entry projected back into the wire shape Settings renders. */
export function effectiveSelection(
  env: ProviderEnv,
  stored: { readonly provider: string; readonly modelId: string } | null,
): { readonly provider: string; readonly modelId: string } | null {
  const entry = effectiveProvider(env, stored);
  if (entry === null) return null;
  return { provider: entry.id, modelId: resolveModelId(entry, stored?.modelId) };
}

/** The provider a turn will run on, or the ONE sentence saying why none can. */
export type ProviderChoice =
  | { readonly ok: true; readonly entry: ProviderEntry; readonly modelId: string }
  | { readonly ok: false; readonly error: string };

/**
 * Resolve the stored selection into a provider that can actually run.
 *
 * ONE function for every surface — the composer, a delegation create, a routine
 * tick, the editor's ⌘J and its ghost text — because the fix is the same in all
 * of them and a second phrasing would only be a second thing to keep true.
 */
export function chooseProvider(
  env: ProviderEnv,
  selection: { readonly provider: string; readonly modelId: string } | null,
  connected: (provider: string) => boolean,
): ProviderChoice {
  const entry = effectiveProvider(env, selection);
  if (entry === null) {
    return {
      ok: false,
      error: "No AI provider is configured on this deployment.",
    };
  }
  if (!connected(entry.id)) {
    return { ok: false, error: `${entry.label} is not connected. Connect it in Settings → AI.` };
  }
  return { ok: true, entry, modelId: resolveModelId(entry, selection?.modelId) };
}
