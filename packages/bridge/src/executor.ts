// ---------------------------------------------------------------------------
// Wire types for executor's daemon HTTP API (pinned to executor 1.5.4),
// shared between the main-process client wrapper and the renderer UI.
//
// v1.5 model: an INTEGRATION is the catalog identity (one API surface, owned
// by a plugin: mcp / openapi / graphql); a CONNECTION is the credential —
// owner-scoped, bound to one integration, identified by (owner, integration,
// name). Tools are addressed per connection:
// `tools.<integration>.<owner>.<connection>.<tool>`. There are no standalone
// secrets (a credential is a connection) and no Google plugin (Google is an
// openapi integration built from a `googleDiscoveryBundle` spec).
//
// Validation stance: request payloads we construct are exact
// (additionalProperties: false); response schemas are tolerant of extra
// fields, because executor adds response fields between patch releases and a
// new field must not become a runtime "invalid response shape" failure.
// ---------------------------------------------------------------------------

import { type Static, Type } from "@sinclair/typebox";

// Google has no dynamic client registration: one OAuth client (bundled at
// build time, or the user's own GCP app) is stored in executor under this
// fixed slug and reused by every Google connector. Shared because both the
// renderer (connect flow, manual-client dialog) and main (bundled-client
// auto-registration) register/reference the same client.
export const GOOGLE_OAUTH_CLIENT_SLUG = "google";
export const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

const NullableNumber = Type.Union([Type.Number(), Type.Null()]);
const NullableString = Type.Union([Type.String(), Type.Null()]);
const StringMapSchema = Type.Record(Type.String(), Type.String());

/** Who owns a connection / OAuth client: the org (tenant-shared) or the user. */
const OwnerSchema = Type.Union([Type.Literal("org"), Type.Literal("user")]);
export type ExecutorOwner = Static<typeof OwnerSchema>;

// ---- integrations ----------------------------------------------------------

/** One declared auth method a connection can bind against (its `template`). */
const ExecutorAuthMethodSchema = Type.Object({
  id: Type.String(),
  label: Type.String(),
  // "oauth" | "apikey" | "header" | "none"
  kind: Type.String(),
  template: Type.String(),
});

export const ExecutorIntegrationSchema = Type.Object({
  slug: Type.String(),
  description: Type.String(),
  // Owning plugin: "mcp" | "openapi" | "graphql" | "built-in" — or an orphaned
  // kind (e.g. "googleDiscovery") naming a plugin the daemon does not ship;
  // migrated daemon data still carries such rows. Hence a bare string, not a
  // union: orphans have no tools and no authMethods.
  kind: Type.String(),
  canRemove: Type.Boolean(),
  canRefresh: Type.Boolean(),
  authMethods: Type.Array(ExecutorAuthMethodSchema),
  displayUrl: Type.Optional(Type.String()),
});
export type ExecutorIntegration = Static<typeof ExecutorIntegrationSchema>;

export const ExecutorDetectResultSchema = Type.Object({
  kind: Type.String(),
  confidence: Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]),
  endpoint: Type.String(),
  name: Type.String(),
  slug: Type.String(),
});
export type ExecutorDetectResult = Static<typeof ExecutorDetectResultSchema>;

// ---- connections -----------------------------------------------------------

export const ExecutorConnectionSchema = Type.Object({
  owner: OwnerSchema,
  name: Type.String(),
  integration: Type.String(),
  /** Which of the integration's declared auth methods this credential binds. */
  template: Type.String(),
  /** Credential backend key (e.g. "keychain", "file"). */
  provider: Type.String(),
  /** `tools.<integration>.<owner>.<name>` — the connection's address prefix. */
  address: Type.String(),
  /** Signed-in identity, caller-supplied at create/oauth-start time. */
  identityLabel: NullableString,
  expiresAt: NullableNumber,
  oauthClient: NullableString,
  oauthClientOwner: Type.Union([OwnerSchema, Type.Null()]),
  oauthScope: NullableString,
});
export type ExecutorConnection = Static<typeof ExecutorConnectionSchema>;

export const CreateConnectionInputSchema = Type.Object(
  {
    owner: OwnerSchema,
    name: Type.String({ minLength: 1 }),
    integration: Type.String({ minLength: 1 }),
    template: Type.String({ minLength: 1 }),
    identityLabel: Type.Optional(Type.String({ minLength: 1 })),
    // Exactly one credential origin (enforced server-side): `value` is sugar
    // for the single `token` input; `values` maps named inputs. No-auth
    // integrations use template "none" with `values: {}`.
    value: Type.Optional(Type.String({ minLength: 1 })),
    values: Type.Optional(StringMapSchema),
  },
  { additionalProperties: false },
);
export type CreateConnectionInput = Static<typeof CreateConnectionInputSchema>;

/** A connection is identified by (owner, integration, name) — no ids. */
export const ConnectionKeyInputSchema = Type.Object(
  {
    owner: OwnerSchema,
    integration: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type ConnectionKeyInput = Static<typeof ConnectionKeyInputSchema>;

// ---- executions (code mode) ------------------------------------------------

/** Result of POST /executions and /executions/:id/resume. */
export const ExecutorExecuteResultSchema = Type.Union([
  Type.Object({
    status: Type.Literal("completed"),
    text: Type.String(),
    structured: Type.Unknown(),
    isError: Type.Boolean(),
  }),
  Type.Object({
    status: Type.Literal("paused"),
    text: Type.String(),
    structured: Type.Unknown(),
  }),
]);
export type ExecutorExecuteResult = Static<typeof ExecutorExecuteResultSchema>;

// ---- generic results --------------------------------------------------------

export const ExecutorRemoveResultSchema = Type.Object({ removed: Type.Boolean() });

export const AddMcpResultSchema = Type.Object({ slug: Type.String() });
export type AddMcpResult = Static<typeof AddMcpResultSchema>;

export const AddOpenApiResultSchema = Type.Object({
  slug: Type.String(),
  toolCount: Type.Number(),
});
export type AddOpenApiResult = Static<typeof AddOpenApiResultSchema>;

export const AddGraphqlResultSchema = Type.Object({ slug: Type.String(), name: Type.String() });
export type AddGraphqlResult = Static<typeof AddGraphqlResultSchema>;

// ---- add-integration request payloads (per plugin) --------------------------

/** mcp.addServer's single-method `auth` shorthand — the one auth input that
 * needs no separate placement declaration. `header` expands to an apikey
 * method with template slug "header"; `oauth2` to template "oauth2". */
const McpAuthShorthandSchema = Type.Union([
  Type.Object({ kind: Type.Literal("none") }, { additionalProperties: false }),
  Type.Object(
    {
      kind: Type.Literal("header"),
      headerName: Type.String({ minLength: 1 }),
      prefix: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal("oauth2") }, { additionalProperties: false }),
]);

const AddMcpRemoteInputSchema = Type.Object(
  {
    transport: Type.Literal("remote"),
    name: Type.String({ minLength: 1 }),
    endpoint: Type.String({ minLength: 1 }),
    remoteTransport: Type.Optional(
      Type.Union([Type.Literal("streamable-http"), Type.Literal("sse"), Type.Literal("auto")]),
    ),
    slug: Type.Optional(Type.String({ minLength: 1 })),
    // Static request config — literal values only; credentials belong on
    // connections, never inlined here.
    headers: Type.Optional(StringMapSchema),
    queryParams: Type.Optional(StringMapSchema),
    auth: Type.Optional(McpAuthShorthandSchema),
  },
  { additionalProperties: false },
);

const AddMcpStdioInputSchema = Type.Object(
  {
    transport: Type.Literal("stdio"),
    name: Type.String({ minLength: 1 }),
    command: Type.String({ minLength: 1 }),
    args: Type.Optional(Type.Array(Type.String())),
    env: Type.Optional(StringMapSchema),
    cwd: Type.Optional(Type.String()),
    slug: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export const AddMcpInputSchema = Type.Union([AddMcpRemoteInputSchema, AddMcpStdioInputSchema]);
export type AddMcpInput = Static<typeof AddMcpInputSchema>;

const OpenApiSpecInputSchema = Type.Union([
  Type.Object(
    { kind: Type.Literal("url"), url: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("blob"), value: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
  // Google Workspace: one integration from one or more Google API Discovery
  // docs. The daemon derives a single `googleOAuth2` auth method with the
  // union of per-API scopes.
  Type.Object(
    {
      kind: Type.Literal("googleDiscoveryBundle"),
      urls: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    },
    { additionalProperties: false },
  ),
]);

export const AddOpenApiInputSchema = Type.Object(
  {
    slug: Type.String({ minLength: 1 }),
    spec: OpenApiSpecInputSchema,
    description: Type.Optional(Type.String()),
    baseUrl: Type.Optional(Type.String({ minLength: 1 })),
    headers: Type.Optional(StringMapSchema),
    queryParams: Type.Optional(StringMapSchema),
  },
  { additionalProperties: false },
);
export type AddOpenApiInput = Static<typeof AddOpenApiInputSchema>;

export const AddGraphqlInputSchema = Type.Object(
  {
    endpoint: Type.String({ minLength: 1 }),
    slug: Type.Optional(Type.String({ minLength: 1 })),
    name: Type.Optional(Type.String({ minLength: 1 })),
    introspectionJson: Type.Optional(Type.String()),
    headers: Type.Optional(StringMapSchema),
    queryParams: Type.Optional(StringMapSchema),
  },
  { additionalProperties: false },
);
export type AddGraphqlInput = Static<typeof AddGraphqlInputSchema>;

// ---- OAuth ------------------------------------------------------------------

/** Register an owner-scoped OAuth app (e.g. the user's Google OAuth client).
 * There is no DCR at Google — the user pastes their own client id/secret. */
export const CreateOAuthClientInputSchema = Type.Object(
  {
    owner: OwnerSchema,
    slug: Type.String({ minLength: 1 }),
    authorizationUrl: Type.String({ minLength: 1 }),
    tokenUrl: Type.String({ minLength: 1 }),
    grant: Type.Union([Type.Literal("authorization_code"), Type.Literal("client_credentials")]),
    clientId: Type.String({ minLength: 1 }),
    clientSecret: Type.String(),
  },
  { additionalProperties: false },
);
export type CreateOAuthClientInput = Static<typeof CreateOAuthClientInputSchema>;

/** RFC 7591 dynamic client registration (MCP servers; not Google). The
 * redirect URI is injected main-side from the live daemon origin. */
export const RegisterDynamicOAuthClientInputSchema = Type.Object(
  {
    owner: OwnerSchema,
    slug: Type.String({ minLength: 1 }),
    registrationEndpoint: Type.String({ minLength: 1 }),
    authorizationUrl: Type.String({ minLength: 1 }),
    tokenUrl: Type.String({ minLength: 1 }),
    resource: Type.Optional(NullableString),
    scopes: Type.Array(Type.String()),
    tokenEndpointAuthMethodsSupported: Type.Optional(Type.Array(Type.String())),
    clientName: Type.Optional(Type.String()),
    originIntegration: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export type RegisterDynamicOAuthClientInput = Static<typeof RegisterDynamicOAuthClientInputSchema>;

/** Metadata-only client summary (never carries the secret). */
export const ExecutorOAuthClientSchema = Type.Object({
  owner: OwnerSchema,
  slug: Type.String(),
  grant: Type.Union([Type.Literal("authorization_code"), Type.Literal("client_credentials")]),
  authorizationUrl: Type.String(),
  tokenUrl: Type.String(),
  clientId: Type.String(),
  origin: Type.Union([
    Type.Object({ kind: Type.Literal("manual") }),
    Type.Object({
      kind: Type.Literal("dynamic_client_registration"),
      integration: Type.Optional(NullableString),
    }),
  ]),
});
export type ExecutorOAuthClient = Static<typeof ExecutorOAuthClientSchema>;

export const CreateOAuthClientResultSchema = Type.Object({ client: Type.String() });

export const OAuthProbeResultSchema = Type.Object({
  authorizationUrl: Type.String(),
  tokenUrl: Type.String(),
  resource: Type.Optional(NullableString),
  scopesSupported: Type.Optional(Type.Array(Type.String())),
  registrationEndpoint: Type.Optional(NullableString),
  tokenEndpointAuthMethodsSupported: Type.Optional(Type.Array(Type.String())),
});
export type OAuthProbeResult = Static<typeof OAuthProbeResultSchema>;

/** Run a client's flow to mint a connection for one integration. The redirect
 * URI is injected main-side from the live daemon origin. */
export const OAuthStartInputSchema = Type.Object(
  {
    client: Type.String({ minLength: 1 }),
    clientOwner: OwnerSchema,
    owner: OwnerSchema,
    name: Type.String({ minLength: 1 }),
    integration: Type.String({ minLength: 1 }),
    template: Type.String({ minLength: 1 }),
    identityLabel: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);
export type OAuthStartInput = Static<typeof OAuthStartInputSchema>;

export const OAuthStartResultSchema = Type.Union([
  // Inline completion (client_credentials grants).
  Type.Object({ status: Type.Literal("connected"), connection: ExecutorConnectionSchema }),
  // The user must visit authorizationUrl; `state` keys the await poll.
  Type.Object({
    status: Type.Literal("redirect"),
    authorizationUrl: Type.String(),
    state: Type.String(),
  }),
]);
export type OAuthStartResult = Static<typeof OAuthStartResultSchema>;

/** Result polled from the auth-exempt GET /api/oauth/await/:state once the
 * browser callback fires. One-shot: consumed on first non-null read. The ok
 * arm spreads the minted connection's fields; we only require what we use. */
export const OAuthAwaitResultSchema = Type.Union([
  Type.Object({
    ok: Type.Literal(true),
    sessionId: Type.String(),
    integration: Type.Optional(Type.String()),
    name: Type.Optional(Type.String()),
    identityLabel: Type.Optional(NullableString),
    expiresAt: Type.Optional(NullableNumber),
    oauthScope: Type.Optional(NullableString),
  }),
  Type.Object({
    ok: Type.Literal(false),
    sessionId: NullableString,
    error: Type.String(),
    errorDetails: Type.Optional(Type.String()),
  }),
]);
export type OAuthAwaitResult = Static<typeof OAuthAwaitResultSchema>;

// ---- connector install (host-orchestrated) ----------------------------------
// The renderer sends ONE install/uninstall request over the Bridge; the host
// owns the whole sequence (register integration → mint connection → browser
// OAuth → rollback on failure) — @repo/connectors/connector-install.ts.

/** An integration to register, fully resolved (slug + name + endpoints). */
const ConnectorSourceSpecSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal("mcp"),
      slug: Type.String({ minLength: 1 }),
      name: Type.String({ minLength: 1 }),
      endpoint: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("openapi"),
      slug: Type.String({ minLength: 1 }),
      name: Type.String({ minLength: 1 }),
      specUrl: Type.String({ minLength: 1 }),
      baseUrl: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("graphql"),
      slug: Type.String({ minLength: 1 }),
      name: Type.String({ minLength: 1 }),
      endpoint: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("google"),
      slug: Type.String({ minLength: 1 }),
      name: Type.String({ minLength: 1 }),
      discoveryUrl: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
]);
export type ConnectorSourceSpec = Static<typeof ConnectorSourceSpecSchema>;

/** How the connector's connection is credentialed, resolved at install time. */
const ConnectorAuthSpecSchema = Type.Union([
  // Open server — a `none`-template connection still has to exist for the
  // integration's tools to be addressable.
  Type.Object({ kind: Type.Literal("none") }, { additionalProperties: false }),
  // MCP transparent DCR OAuth: probe → register client → browser consent.
  Type.Object({ kind: Type.Literal("oauth") }, { additionalProperties: false }),
  // A user-supplied secret rendered as a request header by the connection.
  Type.Object(
    {
      kind: Type.Literal("apiKey"),
      headerName: Type.String({ minLength: 1 }),
      prefix: Type.Optional(Type.String()),
      value: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  // Google OAuth via the user-registered shared "google" client.
  Type.Object({ kind: Type.Literal("google") }, { additionalProperties: false }),
]);

export const ConnectorInstallRequestSchema = Type.Object(
  {
    source: ConnectorSourceSpecSchema,
    auth: ConnectorAuthSpecSchema,
    /** Extra freeform static headers (from the custom dialog). */
    headers: Type.Optional(StringMapSchema),
  },
  { additionalProperties: false },
);
export type ConnectorInstallRequest = Static<typeof ConnectorInstallRequestSchema>;

export const ConnectorUninstallRequestSchema = Type.Object(
  { slug: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);
export type ConnectorUninstallRequest = Static<typeof ConnectorUninstallRequestSchema>;
