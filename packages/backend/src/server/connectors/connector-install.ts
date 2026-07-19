// ---------------------------------------------------------------------------
// Host-side connector install/uninstall orchestration against the executor
// daemon (v1.5 integrations + connections model). Moved out of the renderer
// (#461 Phase 4a): the renderer sends ONE installConnector/uninstallConnector
// request over the Bridge and this module owns the whole sequence — register
// the integration → mint its credentialed connection → run browser OAuth
// (start → open the system browser → poll the one-shot await) → roll back on
// failure — instead of driving 5-8 per-step IPC round-trips.
//
// Ports-injected (ConnectorInstallOps), google-oauth-client style: the handler
// binds the real executor-client + the platform browser-open; tests pass fakes
// and assert the step sequence, rollback, and re-entrancy.
//
// A connector is only "connected" when a live connection (the credential)
// exists for its integration — Google connectors run a real browser OAuth
// consent at connect time (the v1 "consent happens lazily in code mode" path
// was a lie: it never consented and every call dialed unauthenticated).
// ---------------------------------------------------------------------------

import {
  GOOGLE_OAUTH_CLIENT_SLUG,
  type AddGraphqlInput,
  type AddGraphqlResult,
  type AddMcpInput,
  type AddMcpResult,
  type AddOpenApiInput,
  type AddOpenApiResult,
  type ConnectionKeyInput,
  type ConnectorInstallRequest,
  type ConnectorUninstallRequest,
  type CreateConnectionInput,
  type ExecutorConnection,
  type ExecutorIntegration,
  type ExecutorOAuthClient,
  type ExecutorOwner,
  type OAuthAwaitResult,
  type OAuthProbeResult,
  type OAuthStartInput,
  type OAuthStartResult,
  type RegisterDynamicOAuthClientInput,
} from "@repo/bridge/executor";
import type { PendingConnectorAuth } from "@repo/bridge/ipc-registry";

import { isEmulateConnectorsEnabled } from "./emulate-connectors";

/** Everything the orchestration touches, injected so tests can fake the daemon
 * (method names mirror executor-client so the handler binds it 1:1). */
export type ConnectorInstallOps = {
  listIntegrations(): Promise<ExecutorIntegration[]>;
  removeIntegration(slug: string): Promise<{ removed: boolean }>;
  addMcpIntegration(input: AddMcpInput): Promise<AddMcpResult>;
  addOpenApiIntegration(input: AddOpenApiInput): Promise<AddOpenApiResult>;
  addGraphqlIntegration(input: AddGraphqlInput): Promise<AddGraphqlResult>;
  listConnections(): Promise<ExecutorConnection[]>;
  createConnection(input: CreateConnectionInput): Promise<ExecutorConnection>;
  removeConnection(key: ConnectionKeyInput): Promise<{ removed: boolean }>;
  listOAuthClients(): Promise<ExecutorOAuthClient[]>;
  registerOAuthClientDynamic(input: RegisterDynamicOAuthClientInput): Promise<{ client: string }>;
  oauthProbe(url: string): Promise<OAuthProbeResult>;
  oauthStart(input: OAuthStartInput): Promise<OAuthStartResult>;
  awaitOAuth(state: string): Promise<OAuthAwaitResult | null>;
  /** Open the OAuth consent URL in the user's system browser. */
  openExternal(url: string): Promise<void>;
  /** Injectable delay so tests drive the OAuth poll loop without real time. */
  waitMs(ms: number): Promise<void>;
};

/**
 * The connection name credentials are bound under. Tool addresses are
 * connection-scoped (`tools.<integration>.user.<name>.<tool>`); every install
 * here mints its connection as `user.default`, so agents resolve the exact
 * address via tools.search rather than a baked-in path.
 */
export const DEFAULT_CONNECTION_NAME = "default";
const OWNER: ExecutorOwner = "user";

// Auth-method template slugs the daemon derives for the methods we register:
// mcp `auth` shorthand `header` / `oauth2` keep their kind as slug; a Google
// discovery bundle always declares `googleOAuth2`.
const TEMPLATE_NONE = "none";
const TEMPLATE_HEADER = "header";
const TEMPLATE_MCP_OAUTH = "oauth2";
const TEMPLATE_GOOGLE_OAUTH = "googleOAuth2";

const OAUTH_POLL_MS = 1500;
const OAUTH_TIMEOUT_MS = 5 * 60_000;

// Slugs with an install in flight, so a re-entrant call (e.g. a double click
// before the UI marks the card as connecting) can't race the duplicate check
// and double-register / re-run auth.
const installing = new Set<string>();

// DEV-ONLY (#462): the in-flight OAuth consent, exposed over the
// getPendingConnectorAuth channel so a headless E2E drive completes consent
// against emulate instead of spelunking the daemon's SQLite. Only ever set
// under the emulate flag; cleared when the flow settles either way.
let pendingConnectorAuth: PendingConnectorAuth | null = null;

/** The pending consent, or null when none is in flight (or not in emulate
 * mode — the handler additionally refuses the channel outright then). */
export function getPendingConnectorAuth(): PendingConnectorAuth | null {
  return pendingConnectorAuth;
}

/**
 * Run an executor OAuth flow to mint a connection: start the session with a
 * registered client, open the authorization URL in the system browser, then
 * poll the one-shot await endpoint (keyed by the OAuth `state`) until the
 * callback fires. Resolves once connected; throws on failure or timeout.
 */
async function runOAuthFlow(ops: ConnectorInstallOps, input: OAuthStartInput): Promise<void> {
  const start = await ops.oauthStart(input);
  // Inline completion (client_credentials grants) — nothing to wait for.
  if (start.status === "connected") return;
  if (isEmulateConnectorsEnabled()) {
    pendingConnectorAuth = { authorizationUrl: start.authorizationUrl, state: start.state };
  }
  try {
    await ops.openExternal(start.authorizationUrl);
    const deadline = Date.now() + OAUTH_TIMEOUT_MS;
    for (;;) {
      if (Date.now() > deadline) throw new Error("OAuth timed out.");
      await ops.waitMs(OAUTH_POLL_MS);
      const result = await ops.awaitOAuth(start.state);
      if (!result) continue;
      if (!result.ok) throw new Error(`OAuth failed: ${result.error}`);
      return;
    }
  } finally {
    pendingConnectorAuth = null;
  }
}

/**
 * Register an integration and mint its credentialed connection.
 *
 * Refuses up front if the slug is already taken — except for Google, where two
 * recoverable shapes exist: a dead `googleDiscovery` orphan left by executor's
 * v1→v2 data migration (deleted and re-created as a discovery bundle), and a
 * live integration whose consent never finished (creation is skipped and only
 * the OAuth flow runs). On failure, an integration this call created is rolled
 * back so a failed install leaves nothing behind.
 */
export async function installConnector(
  ops: ConnectorInstallOps,
  req: ConnectorInstallRequest,
): Promise<void> {
  const slug = req.source.slug;
  if (installing.has(slug)) {
    throw new Error(`An install for "${slug}" is already in progress.`);
  }
  installing.add(slug);
  let createdIntegration = false;
  try {
    // Fails closed: if the catalog can't be listed we can't rule out a
    // duplicate, so the error propagates and the install aborts.
    const integrations = await ops.listIntegrations();
    let existing = integrations.find((i) => i.slug === slug);

    if (existing && req.source.type === "google" && existing.kind === "googleDiscovery") {
      // v1 google-discovery sources survive executor's v1→v2 migration as dead
      // integrations (plugin gone: no tools, no auth methods). Replace with a
      // live openapi googleDiscoveryBundle integration.
      await ops.removeIntegration(slug);
      existing = undefined;
    }
    if (existing && req.source.type !== "google") {
      throw new Error(`A connector for "${slug}" is already installed.`);
    }
    if (!existing) {
      await registerIntegration(ops, req);
      createdIntegration = true;
    }
    await connectAuth(ops, req);
  } catch (err) {
    // Only undo an integration this call just created — a pre-existing one
    // (the resumable Google case) is left untouched.
    if (createdIntegration) await rollbackIntegration(ops, slug);
    throw err;
  } finally {
    installing.delete(slug);
  }
}

/** Register the integration itself (the catalog entry; no credentials yet). */
async function registerIntegration(
  ops: ConnectorInstallOps,
  req: ConnectorInstallRequest,
): Promise<void> {
  const { source: s, auth, headers } = req;
  switch (s.type) {
    case "mcp": {
      // Declare the auth method up front so the connection minted afterwards
      // has a template to bind: header → apikey placements, oauth2 → OAuth.
      const shorthand =
        auth.kind === "oauth"
          ? { kind: "oauth2" as const }
          : auth.kind === "apiKey"
            ? {
                kind: "header" as const,
                headerName: auth.headerName,
                ...(auth.prefix === undefined ? {} : { prefix: auth.prefix }),
              }
            : { kind: "none" as const };
      await ops.addMcpIntegration({
        transport: "remote",
        name: s.name,
        endpoint: s.endpoint,
        remoteTransport: "auto",
        slug: s.slug,
        ...(headers === undefined ? {} : { headers }),
        auth: shorthand,
      });
      return;
    }
    case "openapi":
      await ops.addOpenApiIntegration({
        slug: s.slug,
        spec: { kind: "url", url: s.specUrl },
        description: s.name,
        baseUrl: s.baseUrl,
        ...(headers === undefined ? {} : { headers }),
      });
      return;
    case "graphql":
      await ops.addGraphqlIntegration({
        endpoint: s.endpoint,
        slug: s.slug,
        name: s.name,
        ...(headers === undefined ? {} : { headers }),
      });
      return;
    case "google":
      // One integration per Google service, from its Discovery doc. The daemon
      // derives the googleOAuth2 auth method (with that service's scopes).
      await ops.addOpenApiIntegration({
        slug: s.slug,
        spec: { kind: "googleDiscoveryBundle", urls: [s.discoveryUrl] },
        description: s.name,
      });
      return;
  }
}

/** Mint the connection (the credential) that makes the integration's tools
 * addressable. For OAuth kinds this is where the browser consent happens. */
async function connectAuth(ops: ConnectorInstallOps, req: ConnectorInstallRequest): Promise<void> {
  const slug = req.source.slug;
  switch (req.auth.kind) {
    case "none":
      await ops.createConnection({
        owner: OWNER,
        name: DEFAULT_CONNECTION_NAME,
        integration: slug,
        template: TEMPLATE_NONE,
        values: {},
      });
      return;
    case "apiKey":
      if (req.source.type !== "mcp") {
        throw new Error("API-key auth is only supported for MCP connectors.");
      }
      await ops.createConnection({
        owner: OWNER,
        name: DEFAULT_CONNECTION_NAME,
        integration: slug,
        template: TEMPLATE_HEADER,
        value: req.auth.value,
      });
      return;
    case "oauth":
      if (req.source.type !== "mcp") {
        throw new Error("OAuth is only supported for MCP connectors.");
      }
      await runMcpDcrOAuth(ops, slug, req.source.endpoint, req.source.name);
      return;
    case "google":
      if (req.source.type !== "google") {
        throw new Error("Google auth is only supported for Google connectors.");
      }
      // Requires the shared "google" OAuth client to be registered first —
      // ConnectorsSection ensures it via ensureGoogleOAuthClient (bundled
      // client auto-seeded when the build carries one, else the user pastes
      // their GCP app).
      await runOAuthFlow(ops, {
        client: GOOGLE_OAUTH_CLIENT_SLUG,
        clientOwner: OWNER,
        owner: OWNER,
        name: DEFAULT_CONNECTION_NAME,
        integration: slug,
        template: TEMPLATE_GOOGLE_OAUTH,
      });
      return;
  }
}

/**
 * MCP transparent DCR connect: probe the server's OAuth metadata, register a
 * dynamic client against its registration endpoint (reusing one this
 * integration minted before, e.g. from an earlier failed consent), then run
 * the browser consent flow.
 */
async function runMcpDcrOAuth(
  ops: ConnectorInstallOps,
  integration: string,
  endpoint: string,
  name: string,
): Promise<void> {
  const probe = await ops.oauthProbe(endpoint);
  const registrationEndpoint = probe.registrationEndpoint;
  if (!registrationEndpoint) {
    throw new Error(
      "This server doesn't support automatic client registration. Add it as a custom connector with an API key instead.",
    );
  }
  const clients = await ops.listOAuthClients();
  const existing = clients.find(
    (c) =>
      c.owner === OWNER &&
      c.origin.kind === "dynamic_client_registration" &&
      c.origin.integration === integration,
  );
  const client = existing
    ? existing.slug
    : (
        await ops.registerOAuthClientDynamic({
          owner: OWNER,
          slug: integration,
          registrationEndpoint,
          authorizationUrl: probe.authorizationUrl,
          tokenUrl: probe.tokenUrl,
          ...(probe.resource === undefined ? {} : { resource: probe.resource }),
          scopes: [...(probe.scopesSupported ?? [])],
          ...(probe.tokenEndpointAuthMethodsSupported === undefined
            ? {}
            : {
                tokenEndpointAuthMethodsSupported: [...probe.tokenEndpointAuthMethodsSupported],
              }),
          clientName: name,
          originIntegration: integration,
        })
      ).client;
  await runOAuthFlow(ops, {
    client,
    clientOwner: OWNER,
    owner: OWNER,
    name: DEFAULT_CONNECTION_NAME,
    integration,
    template: TEMPLATE_MCP_OAUTH,
  });
}

/** Best-effort undo when a step after integration creation fails. */
async function rollbackIntegration(ops: ConnectorInstallOps, slug: string): Promise<void> {
  // Connection first (while its integration still resolves), then the
  // integration itself. Registered OAuth clients are kept — they're reusable
  // and removing the user's Google app would be destructive.
  await ops
    .removeConnection({ owner: OWNER, integration: slug, name: DEFAULT_CONNECTION_NAME })
    .catch(() => {});
  await ops.removeIntegration(slug).catch(() => {});
}

/**
 * Remove a connector's integration and every connection bound to it. Every
 * step is attempted even if an earlier one fails (so a partial failure can't
 * orphan the rest), and the first error is surfaced to the caller.
 */
export async function uninstallConnector(
  ops: ConnectorInstallOps,
  req: ConnectorUninstallRequest,
): Promise<void> {
  const errors: unknown[] = [];
  const attempt = async (run: () => Promise<unknown>): Promise<void> => {
    try {
      await run();
    } catch (err) {
      errors.push(err);
    }
  };

  let integrationRemoved = true;
  try {
    await ops.removeIntegration(req.slug);
  } catch (err) {
    errors.push(err);
    integrationRemoved = false;
  }

  // Only tear down credentials once the integration itself is gone — removing
  // a connection a still-registered integration depends on would break it.
  // Listing AFTER the removal also self-corrects if the daemon cascades
  // connection deletes: anything already gone simply doesn't show up.
  if (integrationRemoved) {
    let connections: ExecutorConnection[] = [];
    await attempt(async () => {
      connections = await ops.listConnections();
    });
    for (const c of connections) {
      if (c.integration !== req.slug) continue;
      await attempt(() =>
        ops.removeConnection({
          owner: c.owner,
          integration: c.integration,
          name: c.name,
        }),
      );
    }
  }

  if (errors.length > 0) throw errors[0];
}
