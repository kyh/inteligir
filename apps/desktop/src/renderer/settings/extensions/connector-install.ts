// ---------------------------------------------------------------------------
// One place that knows how to install and uninstall a connector against the
// executor daemon (v1.5 integrations + connections model). Both the catalog
// cards (ConnectorsSection) and the custom "add connector" dialog produce an
// InstallRequest and call installConnector, so the "register integration +
// mint a credentialed connection" sequence lives here once instead of being
// re-implemented per call site.
//
// A connector is only "connected" when a live connection (the credential)
// exists for its integration — Google connectors run a real browser OAuth
// consent at connect time (the v1 "consent happens lazily in code mode" path
// was a lie: it never consented and every call dialed unauthenticated).
// ---------------------------------------------------------------------------

import {
  GOOGLE_OAUTH_CLIENT_SLUG,
  type ExecutorConnection,
  type ExecutorOwner,
} from "@/shared/executor";
import type { DesktopBridge } from "@/shared/ipc";
import type { CatalogConnector } from "@/renderer/settings/extensions/connector-catalog";
import { runOAuthFlow } from "@/renderer/settings/extensions/lib";

/**
 * The connection name credentials are bound under. Tool addresses are
 * connection-scoped (`tools.<integration>.user.<name>.<tool>`) and the seed
 * dashboard widgets (main/seed-widgets.ts) bake `user.default` into their
 * callTool paths — changing either constant breaks them.
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

/** An integration to register, fully resolved (slug + name + endpoints). */
export type IntegrationSpec =
  | { type: "mcp"; slug: string; name: string; endpoint: string }
  | { type: "openapi"; slug: string; name: string; specUrl: string; baseUrl: string }
  | { type: "graphql"; slug: string; name: string; endpoint: string }
  | { type: "google"; slug: string; name: string; discoveryUrl: string };

/** How the connector's connection is credentialed, resolved at install time. */
type AuthSpec =
  // Open server — a `none`-template connection still has to exist for the
  // integration's tools to be addressable.
  | { kind: "none" }
  // MCP transparent DCR OAuth: probe → register client → browser consent.
  | { kind: "oauth" }
  // A user-supplied secret rendered as a request header by the connection.
  | { kind: "apiKey"; headerName: string; prefix?: string | undefined; value: string }
  // Google OAuth via the user-registered shared "google" client.
  | { kind: "google" };

export type InstallRequest = {
  source: IntegrationSpec;
  auth: AuthSpec;
  /** Extra freeform static headers (from the custom dialog). */
  headers?: Record<string, string> | undefined;
};

// Slugs with an install in flight, so a re-entrant call (e.g. a double click
// before the UI marks the card as connecting) can't race the duplicate check
// and double-register / re-run auth.
const installing = new Set<string>();

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
export async function installConnector(bridge: DesktopBridge, req: InstallRequest): Promise<void> {
  const slug = req.source.slug;
  if (installing.has(slug)) {
    throw new Error(`An install for "${slug}" is already in progress.`);
  }
  installing.add(slug);
  let createdIntegration = false;
  try {
    // Fails closed: if the catalog can't be listed we can't rule out a
    // duplicate, so the error propagates and the install aborts.
    const integrations = await bridge.listExecutorIntegrations();
    let existing = integrations.find((i) => i.slug === slug);

    if (existing && req.source.type === "google" && existing.kind === "googleDiscovery") {
      // v1 google-discovery sources survive executor's v1→v2 migration as dead
      // integrations (plugin gone: no tools, no auth methods). Replace with a
      // live openapi googleDiscoveryBundle integration.
      await bridge.removeExecutorIntegration(slug);
      existing = undefined;
    }
    if (existing && req.source.type !== "google") {
      throw new Error(`A connector for "${slug}" is already installed.`);
    }
    if (!existing) {
      await registerIntegration(bridge, req);
      createdIntegration = true;
    }
    await connectAuth(bridge, req);
  } catch (err) {
    // Only undo an integration this call just created — a pre-existing one
    // (the resumable Google case) is left untouched.
    if (createdIntegration) await rollbackIntegration(bridge, slug);
    throw err;
  } finally {
    installing.delete(slug);
  }
}

/** Register the integration itself (the catalog entry; no credentials yet). */
async function registerIntegration(bridge: DesktopBridge, req: InstallRequest): Promise<void> {
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
      await bridge.addMcpIntegration({
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
      await bridge.addOpenApiIntegration({
        slug: s.slug,
        spec: { kind: "url", url: s.specUrl },
        description: s.name,
        baseUrl: s.baseUrl,
        ...(headers === undefined ? {} : { headers }),
      });
      return;
    case "graphql":
      await bridge.addGraphqlIntegration({
        endpoint: s.endpoint,
        slug: s.slug,
        name: s.name,
        ...(headers === undefined ? {} : { headers }),
      });
      return;
    case "google":
      // One integration per Google service, from its Discovery doc. The daemon
      // derives the googleOAuth2 auth method (with that service's scopes).
      await bridge.addOpenApiIntegration({
        slug: s.slug,
        spec: { kind: "googleDiscoveryBundle", urls: [s.discoveryUrl] },
        description: s.name,
      });
      return;
  }
}

/** Mint the connection (the credential) that makes the integration's tools
 * addressable. For OAuth kinds this is where the browser consent happens. */
async function connectAuth(bridge: DesktopBridge, req: InstallRequest): Promise<void> {
  const slug = req.source.slug;
  switch (req.auth.kind) {
    case "none":
      await bridge.createExecutorConnection({
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
      await bridge.createExecutorConnection({
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
      await runMcpDcrOAuth(bridge, slug, req.source.endpoint, req.source.name);
      return;
    case "google":
      if (req.source.type !== "google") {
        throw new Error("Google auth is only supported for Google connectors.");
      }
      // Requires the shared "google" OAuth client to be registered first —
      // ConnectorsSection ensures it via main (bundled client auto-seeded
      // when the build carries one, else the user pastes their GCP app).
      await runOAuthFlow(bridge, {
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
  bridge: DesktopBridge,
  integration: string,
  endpoint: string,
  name: string,
): Promise<void> {
  const probe = await bridge.executorOAuthProbe(endpoint);
  const registrationEndpoint = probe.registrationEndpoint;
  if (!registrationEndpoint) {
    throw new Error(
      "This server doesn't support automatic client registration. Add it as a custom connector with an API key instead.",
    );
  }
  const clients = await bridge.listExecutorOAuthClients();
  const existing = clients.find(
    (c) =>
      c.owner === OWNER &&
      c.origin.kind === "dynamic_client_registration" &&
      c.origin.integration === integration,
  );
  const client = existing
    ? existing.slug
    : (
        await bridge.registerExecutorOAuthClientDynamic({
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
  await runOAuthFlow(bridge, {
    client,
    clientOwner: OWNER,
    owner: OWNER,
    name: DEFAULT_CONNECTION_NAME,
    integration,
    template: TEMPLATE_MCP_OAUTH,
  });
}

/** Best-effort undo when a step after integration creation fails. */
async function rollbackIntegration(bridge: DesktopBridge, slug: string): Promise<void> {
  // Connection first (while its integration still resolves), then the
  // integration itself. Registered OAuth clients are kept — they're reusable
  // and removing the user's Google app would be destructive.
  await bridge
    .removeExecutorConnection({ owner: OWNER, integration: slug, name: DEFAULT_CONNECTION_NAME })
    .catch(() => {});
  await bridge.removeExecutorIntegration(slug).catch(() => {});
}

/**
 * Remove a connector's integration and every connection bound to it. Every
 * step is attempted even if an earlier one fails (so a partial failure can't
 * orphan the rest), and the first error is surfaced to the caller.
 */
export async function uninstallConnector(
  bridge: DesktopBridge,
  opts: { slug: string },
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
    await bridge.removeExecutorIntegration(opts.slug);
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
      connections = await bridge.listExecutorConnections();
    });
    for (const c of connections) {
      if (c.integration !== opts.slug) continue;
      await attempt(() =>
        bridge.removeExecutorConnection({
          owner: c.owner,
          integration: c.integration,
          name: c.name,
        }),
      );
    }
  }

  if (errors.length > 0) throw errors[0];
}

/** Map a catalog connector to an InstallRequest (secret value supplied for API-key connectors). */
export function catalogInstallRequest(
  connector: CatalogConnector,
  secretValue?: string,
): InstallRequest {
  const { install } = connector;
  if (install.type === "google") {
    return {
      source: {
        type: "google",
        slug: connector.id,
        name: connector.name,
        discoveryUrl: install.discoveryUrl,
      },
      auth: { kind: "google" },
    };
  }
  const source: IntegrationSpec = {
    type: "mcp",
    slug: connector.id,
    name: connector.name,
    endpoint: install.endpoint,
  };
  const auth = install.auth;
  if (auth.kind === "apiKey") {
    if (!secretValue) {
      throw new Error("An API-key connector requires a secret value.");
    }
    return {
      source,
      auth: {
        kind: "apiKey",
        headerName: auth.headerName,
        ...(auth.prefix === undefined ? {} : { prefix: auth.prefix }),
        value: secretValue,
      },
    };
  }
  return { source, auth: auth.kind === "oauth" ? { kind: "oauth" } : { kind: "none" } };
}
