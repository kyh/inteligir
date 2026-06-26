// ---------------------------------------------------------------------------
// Typed client over the executor daemon HTTP API (v1.5.4, flat /api/* routes —
// the v1 per-scope prefix is gone). Thin fetch wrappers around the endpoints
// we use; the daemon connection (base URL + bearer token + redirect URI) comes
// from ExecutorDaemon. Responses are TypeBox-validated at this boundary.
// Throws ExecutorClientError on a non-2xx response.
// ---------------------------------------------------------------------------

import { type Static, type TSchema, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { getExecutorDaemon } from "@/main/executor/executor-daemon";
import {
  AddGraphqlResultSchema,
  AddMcpResultSchema,
  AddOpenApiResultSchema,
  CreateOAuthClientResultSchema,
  ExecutorConnectionSchema,
  ExecutorDetectResultSchema,
  ExecutorExecuteResultSchema,
  ExecutorIntegrationSchema,
  ExecutorOAuthClientSchema,
  ExecutorRemoveResultSchema,
  OAuthAwaitResultSchema,
  OAuthProbeResultSchema,
  OAuthStartResultSchema,
  type AddGraphqlInput,
  type AddGraphqlResult,
  type AddMcpInput,
  type AddMcpResult,
  type AddOpenApiInput,
  type AddOpenApiResult,
  type ConnectionKeyInput,
  type CreateConnectionInput,
  type CreateOAuthClientInput,
  type ExecutorConnection,
  type ExecutorDetectResult,
  type ExecutorExecuteResult,
  type ExecutorIntegration,
  type ExecutorOAuthClient,
  type OAuthAwaitResult,
  type OAuthProbeResult,
  type OAuthStartInput,
  type OAuthStartResult,
  type RegisterDynamicOAuthClientInput,
} from "@/shared/executor";

class ExecutorClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ExecutorClientError";
  }
}

const REQUEST_TIMEOUT_MS = 60_000;
const EXECUTION_TIMEOUT_MS = 600_000;

function connection() {
  const conn = getExecutorDaemon().getConnection();
  if (!conn) throw new ExecutorClientError("executor daemon is not running", 503);
  return conn;
}

/** Encode a dynamic path segment (slugs/names may contain reserved chars). */
function enc(value: string): string {
  return encodeURIComponent(value);
}

type RequestOptions = {
  /** Override the default request timeout (code-mode executions run long). */
  timeoutMs?: number;
  body?: unknown;
};

async function readJsonResponse(
  method: string,
  fullPath: string,
  resp: Response,
): Promise<unknown> {
  const text = await resp.text();
  if (!text) {
    throw new ExecutorClientError(`${method} ${fullPath}: empty JSON response`, resp.status);
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    throw new ExecutorClientError(`${method} ${fullPath}: invalid JSON response`, resp.status);
  }
}

async function request<S extends TSchema>(
  method: string,
  path: string,
  schema: S,
  opts: RequestOptions = {},
): Promise<Static<S>> {
  const conn = connection();
  const resp = await fetch(`${conn.baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${conn.token}`,
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    signal: AbortSignal.timeout(opts.timeoutMs ?? REQUEST_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new ExecutorClientError(text || `${method} ${path} failed (${resp.status})`, resp.status);
  }
  const body = await readJsonResponse(method, path, resp);
  if (!Value.Check(schema, body)) {
    throw new ExecutorClientError(`${method} ${path}: invalid response shape`, resp.status);
  }
  return body;
}

// ---- integrations (the catalog; was v1 "sources") ---------------------------

export function listIntegrations(): Promise<ExecutorIntegration[]> {
  return request("GET", "/integrations", Type.Array(ExecutorIntegrationSchema));
}

export function removeIntegration(slug: string): Promise<{ removed: boolean }> {
  return request("DELETE", `/integrations/${enc(slug)}`, ExecutorRemoveResultSchema);
}

export function detectIntegration(url: string): Promise<ExecutorDetectResult[]> {
  return request("POST", "/integrations/detect", Type.Array(ExecutorDetectResultSchema), {
    body: { url },
  });
}

// ---- add integration (per plugin kind) --------------------------------------

export function addMcpIntegration(input: AddMcpInput): Promise<AddMcpResult> {
  return request("POST", "/mcp/servers", AddMcpResultSchema, { body: input });
}

export function addOpenApiIntegration(input: AddOpenApiInput): Promise<AddOpenApiResult> {
  return request("POST", "/openapi/specs", AddOpenApiResultSchema, { body: input });
}

export function addGraphqlIntegration(input: AddGraphqlInput): Promise<AddGraphqlResult> {
  return request("POST", "/graphql/integrations", AddGraphqlResultSchema, { body: input });
}

// ---- connections (the credentials) ------------------------------------------

export function listConnections(): Promise<ExecutorConnection[]> {
  return request("GET", "/connections", Type.Array(ExecutorConnectionSchema));
}

export function createConnection(input: CreateConnectionInput): Promise<ExecutorConnection> {
  return request("POST", "/connections", ExecutorConnectionSchema, { body: input });
}

export function removeConnection(key: ConnectionKeyInput): Promise<{ removed: boolean }> {
  return request(
    "DELETE",
    `/connections/${enc(key.owner)}/${enc(key.integration)}/${enc(key.name)}`,
    ExecutorRemoveResultSchema,
  );
}

// ---- executions (code mode) -------------------------------------------------

function execute(code: string): Promise<ExecutorExecuteResult> {
  return request("POST", "/executions", ExecutorExecuteResultSchema, {
    body: { code },
    timeoutMs: EXECUTION_TIMEOUT_MS,
  });
}

function resumeExecution(
  executionId: string,
  action: "accept" | "decline" | "cancel",
  content?: unknown,
): Promise<ExecutorExecuteResult> {
  return request("POST", `/executions/${enc(executionId)}/resume`, ExecutorExecuteResultSchema, {
    body: { action, content },
    timeoutMs: EXECUTION_TIMEOUT_MS,
  });
}

// Variants for the agent's long-lived execute/resume tools: a daemon crash
// mid-session drops the connection (the exit handler clears it), and without
// a restart attempt every later tool call fails with "daemon is not running"
// for the rest of the session. Mirror the widget path (widget-actions.ts),
// which awaits the idempotent start() before every call — it re-spawns after
// a crash and is a cheap no-op while the daemon is healthy.

export async function executeEnsuringDaemon(code: string): Promise<ExecutorExecuteResult> {
  await getExecutorDaemon().start();
  return execute(code);
}

export async function resumeEnsuringDaemon(
  executionId: string,
  action: "accept" | "decline" | "cancel",
  content?: unknown,
): Promise<ExecutorExecuteResult> {
  await getExecutorDaemon().start();
  return resumeExecution(executionId, action, content);
}

// ---- oauth -------------------------------------------------------------------

export function listOAuthClients(): Promise<ExecutorOAuthClient[]> {
  return request("GET", "/oauth/clients", Type.Array(ExecutorOAuthClientSchema));
}

export function createOAuthClient(input: CreateOAuthClientInput): Promise<{ client: string }> {
  return request("POST", "/oauth/clients", CreateOAuthClientResultSchema, { body: input });
}

export function registerOAuthClientDynamic(
  input: RegisterDynamicOAuthClientInput,
): Promise<{ client: string }> {
  const conn = connection();
  return request("POST", "/oauth/clients/register-dynamic", CreateOAuthClientResultSchema, {
    // Register the daemon's browser-facing callback as the redirect URI so the
    // minted client matches what /oauth/start will send.
    body: { ...input, redirectUri: conn.redirectUri },
  });
}

export function oauthProbe(url: string): Promise<OAuthProbeResult> {
  return request("POST", "/oauth/probe", OAuthProbeResultSchema, { body: { url } });
}

export function oauthStart(input: OAuthStartInput): Promise<OAuthStartResult> {
  const conn = connection();
  return request("POST", "/oauth/start", OAuthStartResultSchema, {
    // Pass the redirect URI explicitly from the live origin rather than
    // trusting the daemon's env-derived default — they're the same value on
    // the pinned-port path, but this also keeps a fallback-port daemon honest.
    body: { ...input, redirectUri: conn.redirectUri },
  });
}

/**
 * Poll the one-shot await endpoint for an OAuth result, keyed by the `state`
 * from oauthStart. This route is auth-exempt and lives outside the typed API.
 * Returns null until the browser callback has fired (then the result is
 * consumed — a second poll for the same state is null forever).
 */
export async function awaitOAuth(state: string): Promise<OAuthAwaitResult | null> {
  const conn = connection();
  const fullPath = `/oauth/await/${enc(state)}`;
  const resp = await fetch(`${conn.baseUrl}${fullPath}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!resp.ok) {
    throw new ExecutorClientError(`oauth await failed (${resp.status})`, resp.status);
  }
  const body = await readJsonResponse("GET", fullPath, resp).catch(() => null);
  // Validate the discriminated union before returning — a malformed/partial
  // body must not be treated as a terminal ok/error result by the poller.
  return Value.Check(OAuthAwaitResultSchema, body) ? body : null;
}
