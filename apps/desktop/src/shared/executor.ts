// ---------------------------------------------------------------------------
// Wire types for executor's daemon HTTP API (pinned to executor 1.4.33),
// shared between the main-process client wrapper and the renderer UI.
// All endpoints are scoped to the active scope; the main process injects the
// scopeId, so renderer-facing calls omit it.
// ---------------------------------------------------------------------------

export type ExecutorSource = {
  id: string;
  scopeId?: string;
  name: string;
  kind: string; // "mcp" | "openapi" | "graphql" | "googleDiscovery" | "built-in" | ...
  url?: string;
  runtime?: boolean;
  canRemove?: boolean;
  canRefresh?: boolean;
  canEdit?: boolean;
};

export type ExecutorDetectResult = {
  kind: string;
  confidence: "high" | "medium" | "low";
  endpoint: string;
  name: string;
  namespace: string;
};

export type ExecutorToolMeta = {
  id: string;
  pluginId: string;
  sourceId: string;
  name: string;
  description?: string;
  mayElicit?: boolean;
  requiresApproval?: boolean;
  approvalDescription?: string;
};

export type ExecutorSecretRef = {
  id: string;
  scopeId: string;
  name: string;
  provider: string;
  createdAt: number;
};

export type ExecutorConnectionRef = {
  id: string;
  scopeId: string;
  provider: string;
  identityLabel: string | null;
  expiresAt: number | null;
  oauthScope: string | null;
  createdAt: number;
  updatedAt: number;
};

/** Result of POST /executions and /executions/:id/resume. */
export type ExecutorExecuteResult =
  | { status: "completed"; text: string; structured: unknown; isError: boolean }
  | { status: "paused"; text: string; structured: unknown };

export type ExecutorAddSourceResult = { toolCount: number; namespace: string };

// ---- add-source request payloads (per plugin kind) ------------------------

export type ExecutorConfiguredValue = string | { secretId: string; prefix?: string };
export type ExecutorConfiguredMap = Record<string, ExecutorConfiguredValue>;

export type AddMcpRemoteSourceInput = {
  transport: "remote";
  name: string;
  endpoint: string;
  remoteTransport?: "streamable-http" | "sse" | "auto";
  namespace?: string;
  headers?: ExecutorConfiguredMap;
  queryParams?: ExecutorConfiguredMap;
};

export type AddMcpStdioSourceInput = {
  transport: "stdio";
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  namespace?: string;
};

export type AddMcpSourceInput = AddMcpRemoteSourceInput | AddMcpStdioSourceInput;

export type AddOpenApiSourceInput = {
  spec: { kind: "url"; url: string } | { kind: "blob"; value: string };
  name: string;
  baseUrl: string;
  namespace: string;
  headers?: ExecutorConfiguredMap;
  queryParams?: ExecutorConfiguredMap;
};

export type AddGraphqlSourceInput = {
  endpoint: string;
  name: string;
  introspectionJson?: string;
  namespace: string;
  headers?: ExecutorConfiguredMap;
  queryParams?: ExecutorConfiguredMap;
};

export type AddGoogleSourceInput = {
  name: string;
  discoveryUrl: string;
  namespace?: string;
  auth: { kind: "none" } | { kind: "oauth2"; connectionId: string; clientIdSecretId: string; clientSecretSecretId: string | null; scopes: string[] };
};

export type SetSecretInput = {
  id: string;
  name: string;
  value: string;
  provider?: string;
};

// ---- OAuth ---------------------------------------------------------------

export type OAuthStartInput = {
  endpoint: string;
  pluginId: string;
  connectionId: string;
  identityLabel?: string;
};

export type OAuthStartResult = {
  sessionId: string;
  authorizationUrl: string | null;
  completedConnection: { connectionId: string } | null;
};

/** Result polled from /api/oauth/await/:sessionId once the browser callback fires. */
export type OAuthAwaitResult =
  | { ok: true; sessionId: string; connectionId: string; expiresAt: number | null; scope: string | null }
  | { ok: false; sessionId: string | null; error: string; errorDetails?: string };
