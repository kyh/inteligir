// ---------------------------------------------------------------------------
// Wire types for the executor daemon, as the Bridge's connector channels carry
// them.
//
// The model: an INTEGRATION is the catalog identity (one API surface, owned by
// a plugin: mcp / openapi / graphql); a CONNECTION is the credential —
// owner-scoped, bound to one integration, identified by (owner, integration,
// name). There are no standalone secrets (a credential is a connection) and no
// Google plugin (Google is an openapi integration built from a
// `googleDiscoveryBundle` spec).
//
// WHAT IS HERE is what a Bridge channel carries, and nothing else. The
// per-step daemon HTTP API — create-connection, execute, the per-plugin
// add-integration payloads, the whole OAuth start/probe/await dance — has no
// schemas here because it has no channels: the host owns an install as ONE
// request (register the integration, mint the connection, run the browser
// OAuth, roll back on failure), so those steps never cross the wire.
//
// Validation stance: request payloads we construct are exact
// (additionalProperties: false); response schemas are tolerant of extra fields,
// because executor adds response fields between patch releases and a new field
// must not become a runtime "invalid response shape" failure.
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

// ---- OAuth ------------------------------------------------------------------

/** Register an owner-scoped OAuth app (the user's own Google OAuth client).
 * There is no dynamic client registration at Google — the user pastes their
 * own client id/secret. */
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

// ---- connector install (host-orchestrated) ----------------------------------
// The renderer sends ONE install/uninstall request over the Bridge; the host
// owns the whole sequence (register integration → mint connection → browser
// OAuth → rollback on failure) host-side.

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
