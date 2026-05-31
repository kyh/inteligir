// ---------------------------------------------------------------------------
// Typed client over the executor daemon HTTP API. Thin fetch wrappers around
// the endpoints we use; the daemon connection (base URL + bearer token +
// active scopeId) comes from ExecutorDaemon. All scope-relative paths inject
// the active scopeId so callers (IPC handlers, the agent execute tool) don't
// have to. Throws ExecutorClientError on a non-2xx response.
// ---------------------------------------------------------------------------

import { getExecutorDaemon } from "@/main/executor/executor-daemon";
import {
  ExecutorAddSourceResultSchema,
  ExecutorConnectionRefSchema,
  ExecutorDetectResultSchema,
  ExecutorExecuteResultSchema,
  ExecutorRefreshResultSchema,
  ExecutorRemoveResultSchema,
  ExecutorSecretRefSchema,
  ExecutorSourceSchema,
  OAuthAwaitResultSchema,
  OAuthStartResultSchema,
  type AddGoogleSourceInput,
  type AddGraphqlSourceInput,
  type AddMcpSourceInput,
  type AddOpenApiSourceInput,
  type ExecutorAddSourceResult,
  type ExecutorConnectionRef,
  type ExecutorDetectResult,
  type ExecutorExecuteResult,
  type ExecutorSecretRef,
  type ExecutorSource,
  type OAuthAwaitResult,
  type OAuthStartInput,
  type OAuthStartResult,
  type SetSecretInput,
} from "@/shared/executor";
import type { ZodType } from "zod";

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

/** Encode a scopeId for use in a path segment (it contains ":" and "/"). */
function enc(value: string): string {
  return encodeURIComponent(value);
}

type RequestOptions = {
  /** Prepend /scopes/<active scopeId> to the path. */
  scoped?: boolean;
  /** Override the default request timeout (code-mode executions run long). */
  timeoutMs?: number;
  body?: unknown;
};

async function readJsonResponse(method: string, fullPath: string, resp: Response): Promise<unknown> {
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

async function request<T>(
  method: string,
  path: string,
  schema: ZodType<T>,
  opts: RequestOptions = {},
): Promise<T> {
  // Resolve the connection once so a concurrent stop()/start() can't mix a
  // stale scopeId into the path with a fresh baseUrl/token.
  const conn = connection();
  const fullPath = opts.scoped ? `/scopes/${enc(conn.scopeId)}${path}` : path;
  const resp = await fetch(`${conn.baseUrl}${fullPath}`, {
    method,
    headers: {
      authorization: `Bearer ${conn.token}`,
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(opts.timeoutMs ?? REQUEST_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new ExecutorClientError(
      text || `${method} ${fullPath} failed (${resp.status})`,
      resp.status,
    );
  }
  const body = await readJsonResponse(method, fullPath, resp);
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ExecutorClientError(`${method} ${fullPath}: invalid response shape`, resp.status);
  }
  return result.data;
}

// ---- sources --------------------------------------------------------------

export function listSources(): Promise<ExecutorSource[]> {
  return request("GET", "/sources", ExecutorSourceSchema.array(), { scoped: true });
}

export function removeSource(sourceId: string): Promise<{ removed: boolean }> {
  return request("DELETE", `/sources/${enc(sourceId)}`, ExecutorRemoveResultSchema, {
    scoped: true,
  });
}

export function refreshSource(sourceId: string): Promise<{ refreshed: boolean }> {
  return request("POST", `/sources/${enc(sourceId)}/refresh`, ExecutorRefreshResultSchema, {
    scoped: true,
  });
}

export function detectSource(url: string): Promise<ExecutorDetectResult[]> {
  return request("POST", "/sources/detect", ExecutorDetectResultSchema.array(), {
    scoped: true,
    body: { url },
  });
}

// ---- add source (per plugin kind) -----------------------------------------

export function addMcpSource(input: AddMcpSourceInput): Promise<ExecutorAddSourceResult> {
  return request("POST", "/mcp/sources", ExecutorAddSourceResultSchema, {
    scoped: true,
    body: input,
  });
}

export function addOpenApiSource(input: AddOpenApiSourceInput): Promise<ExecutorAddSourceResult> {
  return request("POST", "/openapi/specs", ExecutorAddSourceResultSchema, {
    scoped: true,
    body: input,
  });
}

export function addGraphqlSource(input: AddGraphqlSourceInput): Promise<ExecutorAddSourceResult> {
  return request("POST", "/graphql/sources", ExecutorAddSourceResultSchema, {
    scoped: true,
    body: input,
  });
}

export function addGoogleSource(input: AddGoogleSourceInput): Promise<ExecutorAddSourceResult> {
  return request("POST", "/google-discovery/sources", ExecutorAddSourceResultSchema, {
    scoped: true,
    body: input,
  });
}

// ---- secrets --------------------------------------------------------------

export function listSecrets(): Promise<ExecutorSecretRef[]> {
  return request("GET", "/secrets/all", ExecutorSecretRefSchema.array(), { scoped: true });
}

export function setSecret(input: SetSecretInput): Promise<ExecutorSecretRef> {
  return request("POST", "/secrets", ExecutorSecretRefSchema, { scoped: true, body: input });
}

export function removeSecret(secretId: string): Promise<{ removed: boolean }> {
  return request("DELETE", `/secrets/${enc(secretId)}`, ExecutorRemoveResultSchema, {
    scoped: true,
  });
}

// ---- connections ----------------------------------------------------------

export function listConnections(): Promise<ExecutorConnectionRef[]> {
  return request("GET", "/connections", ExecutorConnectionRefSchema.array(), { scoped: true });
}

export function removeConnection(connectionId: string): Promise<{ removed: boolean }> {
  return request("DELETE", `/connections/${enc(connectionId)}`, ExecutorRemoveResultSchema, {
    scoped: true,
  });
}

// ---- executions (code mode) ----------------------------------------------

export function execute(code: string): Promise<ExecutorExecuteResult> {
  // Code mode runs arbitrary agent code against remote APIs — allow long runs.
  return request("POST", "/executions", ExecutorExecuteResultSchema, {
    body: { code },
    timeoutMs: EXECUTION_TIMEOUT_MS,
  });
}

export function resumeExecution(
  executionId: string,
  action: "accept" | "decline" | "cancel",
  content?: unknown,
): Promise<ExecutorExecuteResult> {
  return request(
    "POST",
    `/executions/${enc(executionId)}/resume`,
    ExecutorExecuteResultSchema,
    {
      body: { action, content },
      timeoutMs: EXECUTION_TIMEOUT_MS,
    },
  );
}

// ---- oauth ----------------------------------------------------------------

export function oauthStart(input: OAuthStartInput): Promise<OAuthStartResult> {
  const conn = connection();
  // dynamic-dcr: zero pre-configured credentials; the daemon hosts the callback.
  return request(
    "POST",
    "/oauth/start",
    OAuthStartResultSchema,
    {
      scoped: true,
      body: {
        endpoint: input.endpoint,
        redirectUrl: `${conn.baseUrl}/oauth/callback`,
        connectionId: input.connectionId,
        tokenScope: conn.scopeId,
        strategy: { kind: "dynamic-dcr" },
        pluginId: input.pluginId,
        ...(input.identityLabel ? { identityLabel: input.identityLabel } : {}),
      },
    },
  );
}

/**
 * Poll the one-shot await endpoint for an OAuth result. This route is
 * auth-exempt and lives outside the typed API. Returns null until the browser
 * callback has fired (then the result is consumed).
 */
export async function awaitOAuth(sessionId: string): Promise<OAuthAwaitResult | null> {
  const conn = connection();
  const fullPath = `/oauth/await/${enc(sessionId)}`;
  const resp = await fetch(`${conn.baseUrl}${fullPath}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  // A non-2xx is a real backend failure (daemon down, route error) — surface it
  // so the poller fails fast instead of mistaking it for "callback not fired".
  if (!resp.ok) {
    throw new ExecutorClientError(`oauth await failed (${resp.status})`, resp.status);
  }
  const body = await readJsonResponse("GET", fullPath, resp).catch(() => null);
  // Validate the discriminated union before returning — a malformed/partial
  // body must not be treated as a terminal ok/error result by the poller.
  const result = OAuthAwaitResultSchema.safeParse(body);
  return result.success ? result.data : null;
}
