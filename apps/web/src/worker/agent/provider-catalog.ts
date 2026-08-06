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

export type ProviderEntry = {
  readonly id: string;
  readonly label: string;
  /** The single hostname this provider's traffic leaves the container on. The
   * egress allowlist and the interceptor are both keyed on it. */
  readonly apiHost: string;
  /** Base URL the container's pi runtime is pointed at. */
  readonly baseUrl: string;
  readonly auth: ProviderAuthStyle;
  /** Extra headers the provider requires on every request, injected alongside
   * the credential so the container never has to know them. */
  readonly extraHeaders: Readonly<Record<string, string>>;
  readonly defaultModelId: string;
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
  auth: { header: "authorization", prefix: "Bearer " },
  // Anthropic rejects a request with no API version, and the version is a
  // property of the wire contract this Worker speaks — not of the image.
  extraHeaders: { "anthropic-version": "2023-06-01" },
  defaultModelId: "claude-sonnet-5",
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
  auth: { header: "authorization", prefix: "Bearer " },
  extraHeaders: {},
  defaultModelId: "gpt-5.5",
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
  auth: { header: "authorization", prefix: "Bearer " },
  extraHeaders: {},
  defaultModelId: "sandbox-1",
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
export function providerOAuthApp(env: Env, id: string): ProviderOAuthApp | null {
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
export function providerOAuthSecret(env: Env, id: string): string | null {
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
export function sandboxRuntimeEnabled(env: Env): boolean {
  return env.AGENT_RUNTIME !== "scripted";
}

/**
 * Whether this deployment can offer `entry` at all: a real provider needs its
 * OAuth app configured, and `sandbox` exists only where the real runtime does
 * not — offering a scripted agent beside a real one would be a menu entry
 * nobody could tell apart from a broken provider.
 */
function providerOffered(env: Env, entry: ProviderEntry): boolean {
  if (!entry.requiresAuth) return !sandboxRuntimeEnabled(env);
  return providerOAuthApp(env, entry.id) !== null;
}

/** The providers this deployment offers, in menu order. */
export function offeredProviders(env: Env): readonly ProviderEntry[] {
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
