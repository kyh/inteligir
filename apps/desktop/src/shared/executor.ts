// ---------------------------------------------------------------------------
// Wire types for executor's daemon HTTP API (pinned to executor 1.4.33),
// shared between the main-process client wrapper and the renderer UI.
// All endpoints are scoped to the active scope; the main process injects the
// scopeId, so renderer-facing calls omit it.
// ---------------------------------------------------------------------------

import { z } from "zod";

export const ExecutorSourceSchema = z.object({
  id: z.string(),
  scopeId: z.string().nullish(),
  name: z.string(),
  // The namespace the source was registered under (what tool calls are prefixed
  // with). Present on newer daemons; when absent, the source id is the namespace.
  namespace: z.string().nullish(),
  // "mcp" | "openapi" | "graphql" | "googleDiscovery" | "built-in" | ...
  kind: z.string(),
  url: z.string().nullish(),
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

const ExecutorConfiguredValueSchema = z.union([
  z.string(),
  z.object({
    secretId: z.string().min(1),
    prefix: z.string().optional(),
  }),
]);
const ExecutorConfiguredMapSchema = z.record(z.string(), ExecutorConfiguredValueSchema);

const AddMcpRemoteSourceInputSchema = z.object({
  transport: z.literal("remote"),
  name: z.string().min(1),
  endpoint: z.string().min(1),
  remoteTransport: z.enum(["streamable-http", "sse", "auto"]).optional(),
  namespace: z.string().min(1).optional(),
  headers: ExecutorConfiguredMapSchema.optional(),
  queryParams: ExecutorConfiguredMapSchema.optional(),
});

const AddMcpStdioSourceInputSchema = z.object({
  transport: z.literal("stdio"),
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  namespace: z.string().min(1).optional(),
});

export const AddMcpSourceInputSchema = z.discriminatedUnion("transport", [
  AddMcpRemoteSourceInputSchema,
  AddMcpStdioSourceInputSchema,
]);
export type AddMcpSourceInput = z.infer<typeof AddMcpSourceInputSchema>;

const OpenApiSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("url"), url: z.string().min(1) }),
  z.object({ kind: z.literal("blob"), value: z.string().min(1) }),
]);

export const AddOpenApiSourceInputSchema = z.object({
  spec: OpenApiSpecSchema,
  name: z.string().min(1),
  baseUrl: z.string().min(1),
  namespace: z.string().min(1),
  headers: ExecutorConfiguredMapSchema.optional(),
  queryParams: ExecutorConfiguredMapSchema.optional(),
});
export type AddOpenApiSourceInput = z.infer<typeof AddOpenApiSourceInputSchema>;

export const AddGraphqlSourceInputSchema = z.object({
  endpoint: z.string().min(1),
  name: z.string().min(1),
  introspectionJson: z.string().optional(),
  namespace: z.string().min(1),
  headers: ExecutorConfiguredMapSchema.optional(),
  queryParams: ExecutorConfiguredMapSchema.optional(),
});
export type AddGraphqlSourceInput = z.infer<typeof AddGraphqlSourceInputSchema>;

const GoogleAuthSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("oauth2"),
    connectionId: z.string().min(1),
    clientIdSecretId: z.string().min(1),
    clientSecretSecretId: z.string().min(1).nullable(),
    scopes: z.array(z.string().min(1)),
  }),
]);

export const AddGoogleSourceInputSchema = z.object({
  name: z.string().min(1),
  discoveryUrl: z.string().min(1),
  namespace: z.string().min(1).optional(),
  auth: GoogleAuthSchema,
});
export type AddGoogleSourceInput = z.infer<typeof AddGoogleSourceInputSchema>;

export const SetSecretInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  value: z.string().min(1),
  provider: z.string().min(1).optional(),
});
export type SetSecretInput = z.infer<typeof SetSecretInputSchema>;

// ---- OAuth ---------------------------------------------------------------

export const OAuthStartInputSchema = z.object({
  endpoint: z.string().min(1),
  pluginId: z.string().min(1),
  connectionId: z.string().min(1),
  identityLabel: z.string().min(1).optional(),
});
export type OAuthStartInput = z.infer<typeof OAuthStartInputSchema>;

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
