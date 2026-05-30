// ---------------------------------------------------------------------------
// Wire types for executor's daemon HTTP API (pinned to executor 1.4.33),
// shared between the main-process client wrapper and the renderer UI.
// All endpoints are scoped to the active scope; the main process injects the
// scopeId, so renderer-facing calls omit it.
// ---------------------------------------------------------------------------

import { z } from "zod";

export const ExecutorSourceSchema = z.object({
  id: z.string(),
  scopeId: z.string().optional(),
  name: z.string(),
  // "mcp" | "openapi" | "graphql" | "googleDiscovery" | "built-in" | ...
  kind: z.string(),
  url: z.string().optional(),
  runtime: z.boolean().optional(),
  canRemove: z.boolean().optional(),
  canRefresh: z.boolean().optional(),
  canEdit: z.boolean().optional(),
});
export type ExecutorSource = z.infer<typeof ExecutorSourceSchema>;

export const ExecutorDetectResultSchema = z.object({
  kind: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  endpoint: z.string(),
  name: z.string(),
  namespace: z.string(),
});
export type ExecutorDetectResult = z.infer<typeof ExecutorDetectResultSchema>;

export const ExecutorToolMetaSchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  sourceId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  mayElicit: z.boolean().optional(),
  requiresApproval: z.boolean().optional(),
  approvalDescription: z.string().optional(),
});
export type ExecutorToolMeta = z.infer<typeof ExecutorToolMetaSchema>;

export const ExecutorSecretRefSchema = z.object({
  id: z.string(),
  scopeId: z.string(),
  name: z.string(),
  provider: z.string(),
  createdAt: z.number(),
});
export type ExecutorSecretRef = z.infer<typeof ExecutorSecretRefSchema>;

export const ExecutorConnectionRefSchema = z.object({
  id: z.string(),
  scopeId: z.string(),
  provider: z.string(),
  identityLabel: z.string().nullable(),
  expiresAt: z.number().nullable(),
  oauthScope: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type ExecutorConnectionRef = z.infer<typeof ExecutorConnectionRefSchema>;

/** Result of POST /executions and /executions/:id/resume. */
export const ExecutorExecuteResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("completed"),
    text: z.string(),
    structured: z.unknown(),
    isError: z.boolean(),
  }),
  z.object({
    status: z.literal("paused"),
    text: z.string(),
    structured: z.unknown(),
  }),
]);
export type ExecutorExecuteResult = z.infer<typeof ExecutorExecuteResultSchema>;

export const ExecutorAddSourceResultSchema = z.object({
  toolCount: z.number(),
  namespace: z.string(),
});
export type ExecutorAddSourceResult = z.infer<typeof ExecutorAddSourceResultSchema>;

export const ExecutorRemoveResultSchema = z.object({ removed: z.boolean() });
export const ExecutorRefreshResultSchema = z.object({ refreshed: z.boolean() });

// ---- add-source request payloads (per plugin kind) ------------------------

type ExecutorConfiguredValue = string | { secretId: string; prefix?: string };
type ExecutorConfiguredMap = Record<string, ExecutorConfiguredValue>;

type AddMcpRemoteSourceInput = {
  transport: "remote";
  name: string;
  endpoint: string;
  remoteTransport?: "streamable-http" | "sse" | "auto";
  namespace?: string;
  headers?: ExecutorConfiguredMap;
  queryParams?: ExecutorConfiguredMap;
};

type AddMcpStdioSourceInput = {
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
  auth:
    | { kind: "none" }
    | {
        kind: "oauth2";
        connectionId: string;
        clientIdSecretId: string;
        clientSecretSecretId: string | null;
        scopes: string[];
      };
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

export const OAuthStartResultSchema = z.object({
  sessionId: z.string(),
  authorizationUrl: z.string().nullable(),
  completedConnection: z.object({ connectionId: z.string() }).nullable(),
});
export type OAuthStartResult = z.infer<typeof OAuthStartResultSchema>;

/** Result polled from /api/oauth/await/:sessionId once the browser callback fires. */
export const OAuthAwaitResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    sessionId: z.string(),
    connectionId: z.string(),
    expiresAt: z.number().nullable(),
    scope: z.string().nullable(),
  }),
  z.object({
    ok: z.literal(false),
    sessionId: z.string().nullable(),
    error: z.string(),
    errorDetails: z.string().optional(),
  }),
]);
export type OAuthAwaitResult = z.infer<typeof OAuthAwaitResultSchema>;
