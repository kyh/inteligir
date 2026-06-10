// ---------------------------------------------------------------------------
// Wire types for executor's daemon HTTP API (pinned to executor 1.4.33),
// shared between the main-process client wrapper and the renderer UI.
// All endpoints are scoped to the active scope; the main process injects the
// scopeId, so renderer-facing calls omit it.
// ---------------------------------------------------------------------------

import { type Static, Type } from "@sinclair/typebox";

// Helpers — TypeBox doesn't have a built-in `.nullish()`; spell it out.
const NullishString = Type.Optional(Type.Union([Type.String(), Type.Null()]));
const NullableNumber = Type.Union([Type.Number(), Type.Null()]);
const NullableString = Type.Union([Type.String(), Type.Null()]);

export const ExecutorSourceSchema = Type.Object(
  {
    id: Type.String(),
    scopeId: NullishString,
    name: Type.String(),
    // The namespace the source was registered under (what tool calls are prefixed
    // with). Present on newer daemons; when absent, the source id is the namespace.
    namespace: NullishString,
    // "mcp" | "openapi" | "graphql" | "googleDiscovery" | "built-in" | ...
    kind: Type.String(),
    url: NullishString,
    runtime: Type.Optional(Type.Boolean()),
    canRemove: Type.Optional(Type.Boolean()),
    canRefresh: Type.Optional(Type.Boolean()),
    canEdit: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type ExecutorSource = Static<typeof ExecutorSourceSchema>;

export const ExecutorDetectResultSchema = Type.Object(
  {
    kind: Type.String(),
    confidence: Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]),
    endpoint: Type.String(),
    name: Type.String(),
    namespace: Type.String(),
  },
  { additionalProperties: false },
);
export type ExecutorDetectResult = Static<typeof ExecutorDetectResultSchema>;

export const ExecutorSecretRefSchema = Type.Object(
  {
    id: Type.String(),
    scopeId: Type.String(),
    name: Type.String(),
    provider: Type.String(),
    createdAt: Type.Number(),
  },
  { additionalProperties: false },
);
export type ExecutorSecretRef = Static<typeof ExecutorSecretRefSchema>;

export const ExecutorConnectionRefSchema = Type.Object(
  {
    id: Type.String(),
    scopeId: Type.String(),
    provider: Type.String(),
    identityLabel: NullableString,
    expiresAt: NullableNumber,
    oauthScope: NullableString,
    createdAt: Type.Number(),
    updatedAt: Type.Number(),
  },
  { additionalProperties: false },
);
export type ExecutorConnectionRef = Static<typeof ExecutorConnectionRefSchema>;

/** Result of POST /executions and /executions/:id/resume. */
export const ExecutorExecuteResultSchema = Type.Union([
  Type.Object(
    {
      status: Type.Literal("completed"),
      text: Type.String(),
      structured: Type.Unknown(),
      isError: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      status: Type.Literal("paused"),
      text: Type.String(),
      structured: Type.Unknown(),
    },
    { additionalProperties: false },
  ),
]);
export type ExecutorExecuteResult = Static<typeof ExecutorExecuteResultSchema>;

export const ExecutorAddSourceResultSchema = Type.Object(
  { toolCount: Type.Number(), namespace: Type.String() },
  { additionalProperties: false },
);
export type ExecutorAddSourceResult = Static<typeof ExecutorAddSourceResultSchema>;

export const ExecutorRemoveResultSchema = Type.Object(
  { removed: Type.Boolean() },
  { additionalProperties: false },
);
export const ExecutorRefreshResultSchema = Type.Object(
  { refreshed: Type.Boolean() },
  { additionalProperties: false },
);

// ---- add-source request payloads (per plugin kind) ------------------------

const ExecutorConfiguredValueSchema = Type.Union([
  Type.String(),
  Type.Object(
    {
      secretId: Type.String({ minLength: 1 }),
      prefix: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
]);
const ExecutorConfiguredMapSchema = Type.Record(Type.String(), ExecutorConfiguredValueSchema);

const AddMcpRemoteSourceInputSchema = Type.Object(
  {
    transport: Type.Literal("remote"),
    name: Type.String({ minLength: 1 }),
    endpoint: Type.String({ minLength: 1 }),
    remoteTransport: Type.Optional(
      Type.Union([Type.Literal("streamable-http"), Type.Literal("sse"), Type.Literal("auto")]),
    ),
    namespace: Type.Optional(Type.String({ minLength: 1 })),
    headers: Type.Optional(ExecutorConfiguredMapSchema),
    queryParams: Type.Optional(ExecutorConfiguredMapSchema),
  },
  { additionalProperties: false },
);

const AddMcpStdioSourceInputSchema = Type.Object(
  {
    transport: Type.Literal("stdio"),
    name: Type.String({ minLength: 1 }),
    command: Type.String({ minLength: 1 }),
    args: Type.Optional(Type.Array(Type.String())),
    env: Type.Optional(Type.Record(Type.String(), Type.String())),
    cwd: Type.Optional(Type.String()),
    namespace: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export const AddMcpSourceInputSchema = Type.Union([
  AddMcpRemoteSourceInputSchema,
  AddMcpStdioSourceInputSchema,
]);
export type AddMcpSourceInput = Static<typeof AddMcpSourceInputSchema>;

const OpenApiSpecSchema = Type.Union([
  Type.Object(
    { kind: Type.Literal("url"), url: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("blob"), value: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
]);

export const AddOpenApiSourceInputSchema = Type.Object(
  {
    spec: OpenApiSpecSchema,
    name: Type.String({ minLength: 1 }),
    baseUrl: Type.String({ minLength: 1 }),
    namespace: Type.String({ minLength: 1 }),
    headers: Type.Optional(ExecutorConfiguredMapSchema),
    queryParams: Type.Optional(ExecutorConfiguredMapSchema),
  },
  { additionalProperties: false },
);
export type AddOpenApiSourceInput = Static<typeof AddOpenApiSourceInputSchema>;

export const AddGraphqlSourceInputSchema = Type.Object(
  {
    endpoint: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    introspectionJson: Type.Optional(Type.String()),
    namespace: Type.String({ minLength: 1 }),
    headers: Type.Optional(ExecutorConfiguredMapSchema),
    queryParams: Type.Optional(ExecutorConfiguredMapSchema),
  },
  { additionalProperties: false },
);
export type AddGraphqlSourceInput = Static<typeof AddGraphqlSourceInputSchema>;

const GoogleAuthSchema = Type.Union([
  Type.Object({ kind: Type.Literal("none") }, { additionalProperties: false }),
  Type.Object(
    {
      kind: Type.Literal("oauth2"),
      connectionId: Type.String({ minLength: 1 }),
      clientIdSecretId: Type.String({ minLength: 1 }),
      clientSecretSecretId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
      scopes: Type.Array(Type.String({ minLength: 1 })),
    },
    { additionalProperties: false },
  ),
]);

export const AddGoogleSourceInputSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    discoveryUrl: Type.String({ minLength: 1 }),
    namespace: Type.Optional(Type.String({ minLength: 1 })),
    auth: GoogleAuthSchema,
  },
  { additionalProperties: false },
);
export type AddGoogleSourceInput = Static<typeof AddGoogleSourceInputSchema>;

export const SetSecretInputSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    value: Type.String({ minLength: 1 }),
    provider: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);
export type SetSecretInput = Static<typeof SetSecretInputSchema>;

// ---- OAuth ---------------------------------------------------------------

export const OAuthStartInputSchema = Type.Object(
  {
    endpoint: Type.String({ minLength: 1 }),
    pluginId: Type.String({ minLength: 1 }),
    connectionId: Type.String({ minLength: 1 }),
    identityLabel: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);
export type OAuthStartInput = Static<typeof OAuthStartInputSchema>;

export const OAuthStartResultSchema = Type.Object(
  {
    sessionId: Type.String(),
    authorizationUrl: NullableString,
    completedConnection: Type.Union([
      Type.Object({ connectionId: Type.String() }, { additionalProperties: false }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);
export type OAuthStartResult = Static<typeof OAuthStartResultSchema>;

/** Result polled from /api/oauth/await/:sessionId once the browser callback fires. */
export const OAuthAwaitResultSchema = Type.Union([
  Type.Object(
    {
      ok: Type.Literal(true),
      sessionId: Type.String(),
      connectionId: Type.String(),
      expiresAt: NullableNumber,
      scope: NullableString,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ok: Type.Literal(false),
      sessionId: NullableString,
      error: Type.String(),
      errorDetails: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
]);
export type OAuthAwaitResult = Static<typeof OAuthAwaitResultSchema>;
