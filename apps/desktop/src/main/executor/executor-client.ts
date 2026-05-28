// ---------------------------------------------------------------------------
// Typed client over the executor daemon HTTP API. Thin fetch wrappers around
// the endpoints we use; the daemon connection (base URL + bearer token +
// active scopeId) comes from ExecutorDaemon. All scope-relative paths inject
// the active scopeId so callers (IPC handlers, the agent execute tool) don't
// have to. Throws ExecutorClientError on a non-2xx response.
// ---------------------------------------------------------------------------

import { getExecutorDaemon } from "@/main/executor/executor-daemon";
import type {
  AddGoogleSourceInput,
  AddGraphqlSourceInput,
  AddMcpSourceInput,
  AddOpenApiSourceInput,
  ExecutorAddSourceResult,
  ExecutorConnectionRef,
  ExecutorDetectResult,
  ExecutorExecuteResult,
  ExecutorPolicy,
  ExecutorScopeInfo,
  ExecutorSecretRef,
  ExecutorSource,
  ExecutorToolMeta,
  ExecutorToolSchema,
  OAuthAwaitResult,
  OAuthStartInput,
  OAuthStartResult,
  SetSecretInput,
} from "@/shared/executor";

export class ExecutorClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ExecutorClientError";
  }
}

const REQUEST_TIMEOUT_MS = 60_000;

function connection() {
  const conn = getExecutorDaemon().getConnection();
  if (!conn) throw new ExecutorClientError("executor daemon is not running", 503);
  return conn;
}

/** Encode a scopeId for use in a path segment (it contains ":" and "/"). */
function enc(value: string): string {
  return encodeURIComponent(value);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const conn = connection();
  const resp = await fetch(`${conn.baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${conn.token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new ExecutorClientError(text || `${method} ${path} failed (${resp.status})`, resp.status);
  }
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

function scopePath(suffix: string): string {
  return `/scopes/${enc(connection().scopeId)}${suffix}`;
}

// ---- scope ----------------------------------------------------------------

export function getScope(): Promise<ExecutorScopeInfo> {
  return request("GET", "/scope");
}

// ---- sources --------------------------------------------------------------

export function listSources(): Promise<ExecutorSource[]> {
  return request("GET", scopePath("/sources"));
}

export function removeSource(sourceId: string): Promise<{ removed: boolean }> {
  return request("DELETE", scopePath(`/sources/${enc(sourceId)}`));
}

export function refreshSource(sourceId: string): Promise<{ refreshed: boolean }> {
  return request("POST", scopePath(`/sources/${enc(sourceId)}/refresh`));
}

export function detectSource(url: string): Promise<ExecutorDetectResult[]> {
  return request("POST", scopePath("/sources/detect"), { url });
}

export function listSourceTools(sourceId: string): Promise<ExecutorToolMeta[]> {
  return request("GET", scopePath(`/sources/${enc(sourceId)}/tools`));
}

// ---- add source (per plugin kind) -----------------------------------------

export function addMcpSource(input: AddMcpSourceInput): Promise<ExecutorAddSourceResult> {
  return request("POST", scopePath("/mcp/sources"), input);
}

export function addOpenApiSource(input: AddOpenApiSourceInput): Promise<ExecutorAddSourceResult> {
  return request("POST", scopePath("/openapi/specs"), input);
}

export function addGraphqlSource(input: AddGraphqlSourceInput): Promise<ExecutorAddSourceResult> {
  return request("POST", scopePath("/graphql/sources"), input);
}

export function addGoogleSource(input: AddGoogleSourceInput): Promise<ExecutorAddSourceResult> {
  return request("POST", scopePath("/google-discovery/sources"), input);
}

// ---- secrets --------------------------------------------------------------

export function listSecrets(): Promise<ExecutorSecretRef[]> {
  return request("GET", scopePath("/secrets/all"));
}

export function setSecret(input: SetSecretInput): Promise<ExecutorSecretRef> {
  return request("POST", scopePath("/secrets"), input);
}

export function removeSecret(secretId: string): Promise<{ removed: boolean }> {
  return request("DELETE", scopePath(`/secrets/${enc(secretId)}`));
}

// ---- connections ----------------------------------------------------------

export function listConnections(): Promise<ExecutorConnectionRef[]> {
  return request("GET", scopePath("/connections"));
}

export function removeConnection(connectionId: string): Promise<{ removed: boolean }> {
  return request("DELETE", scopePath(`/connections/${enc(connectionId)}`));
}

// ---- tools ----------------------------------------------------------------

export function listTools(): Promise<ExecutorToolMeta[]> {
  return request("GET", scopePath("/tools"));
}

export function getToolSchema(toolId: string): Promise<ExecutorToolSchema> {
  return request("GET", scopePath(`/tools/${enc(toolId)}/schema`));
}

// ---- policies -------------------------------------------------------------

export function listPolicies(): Promise<ExecutorPolicy[]> {
  return request("GET", scopePath("/policies"));
}

// ---- executions (code mode) ----------------------------------------------

export function execute(code: string): Promise<ExecutorExecuteResult> {
  return request("POST", "/executions", { code });
}

export function resumeExecution(
  executionId: string,
  action: "accept" | "decline" | "cancel",
  content?: unknown,
): Promise<ExecutorExecuteResult> {
  return request("POST", `/executions/${enc(executionId)}/resume`, { action, content });
}

// ---- oauth ----------------------------------------------------------------

export function oauthStart(input: OAuthStartInput): Promise<OAuthStartResult> {
  const conn = connection();
  // dynamic-dcr: zero pre-configured credentials; the daemon hosts the callback.
  return request("POST", scopePath("/oauth/start"), {
    endpoint: input.endpoint,
    redirectUrl: `${conn.baseUrl}/oauth/callback`,
    connectionId: input.connectionId,
    tokenScope: conn.scopeId,
    strategy: { kind: "dynamic-dcr" },
    pluginId: input.pluginId,
    ...(input.identityLabel ? { identityLabel: input.identityLabel } : {}),
  });
}

/**
 * Poll the one-shot await endpoint for an OAuth result. This route is
 * auth-exempt and lives outside the typed API. Returns null until the browser
 * callback has fired (then the result is consumed).
 */
export async function awaitOAuth(sessionId: string): Promise<OAuthAwaitResult | null> {
  const conn = connection();
  const resp = await fetch(`${conn.baseUrl}/oauth/await/${enc(sessionId)}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!resp.ok) return null;
  const body: unknown = await resp.json().catch(() => null);
  if (!body || typeof body !== "object") return null;
  return body as OAuthAwaitResult;
}
