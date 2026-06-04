// ---------------------------------------------------------------------------
// One place that knows how to install and uninstall a connector against the
// executor daemon. Both the catalog cards (ConnectorsSection) and the custom
// "add connector" dialog produce an InstallRequest and call installConnector,
// so the "register source (+ run OAuth) (+ store secret)" sequence lives here
// once instead of being re-implemented per call site.
// ---------------------------------------------------------------------------

import type { ExecutorConnectionRef } from "@/shared/executor";
import type { DesktopBridge } from "@/shared/ipc";
import type { CatalogConnector } from "@/renderer/shell/builtin/extensions/connector-catalog";
import { oauthConnectionId, runOAuthFlow } from "@/renderer/shell/builtin/extensions/lib";

/** Executor header value — a literal string or a reference to a stored secret. */
type ConfiguredHeader = string | { secretId: string; prefix?: string };

/** A source to register, fully resolved (name + namespace + endpoints). */
export type SourceSpec =
  | { type: "mcp"; name: string; namespace: string; endpoint: string }
  | { type: "openapi"; name: string; namespace: string; specUrl: string; baseUrl: string }
  | { type: "graphql"; name: string; namespace: string; endpoint: string }
  | { type: "google"; name: string; namespace: string; discoveryUrl: string };

/** How the source authenticates, resolved at install time. */
type AuthSpec =
  | { kind: "none" }
  // Dynamic-DCR OAuth against the source endpoint (MCP only).
  | { kind: "oauth" }
  // A user-supplied secret sent as a request header.
  | { kind: "apiKey"; headerName: string; prefix?: string; secretId: string; secretName: string; secretValue: string };

export type InstallRequest = {
  source: SourceSpec;
  auth: AuthSpec;
  /** Extra freeform headers (from the custom dialog), merged with any apiKey header. */
  headers?: Record<string, string>;
};

/**
 * The OAuth connection for a namespace, if any. Matched only on the id we
 * registered it under (mcp-oauth2-<namespace>) — never the provider label,
 * which several connectors can share and would cause us to remove the wrong one.
 */
function findOAuthConnection(
  connections: ExecutorConnectionRef[] | null,
  namespace: string,
): ExecutorConnectionRef | undefined {
  const id = oauthConnectionId(namespace);
  return (connections ?? []).find((c) => c.id === id);
}

/** Auth side-effects, tracked as they happen so any failure can undo them. */
type AppliedAuth = {
  headers?: Record<string, ConfiguredHeader>;
  /** A secret that was created and should be removed on failure. */
  createdSecretId?: string;
  /** A namespace whose OAuth connection should be removed on failure. */
  oauthNamespace?: string;
};

/**
 * Run the auth side-effects (OAuth / secret), recording into `applied` as they
 * happen. `oauthNamespace` is set *before* the OAuth flow runs, so a timeout
 * that leaves a connection behind can still be rolled back.
 */
async function applyAuth(
  bridge: DesktopBridge,
  req: InstallRequest,
  applied: AppliedAuth,
): Promise<void> {
  const headers: Record<string, ConfiguredHeader> = { ...req.headers };
  if (req.auth.kind === "oauth") {
    if (req.source.type !== "mcp") throw new Error("OAuth is only supported for MCP sources.");
    applied.oauthNamespace = req.source.namespace;
    await runOAuthFlow(bridge, req.source.endpoint, oauthConnectionId(req.source.namespace));
  } else if (req.auth.kind === "apiKey") {
    await bridge.setExecutorSecret({
      id: req.auth.secretId,
      name: req.auth.secretName,
      value: req.auth.secretValue,
      provider: req.source.namespace,
    });
    applied.createdSecretId = req.auth.secretId;
    headers[req.auth.headerName] = { secretId: req.auth.secretId, prefix: req.auth.prefix };
  }
  applied.headers = Object.keys(headers).length > 0 ? headers : undefined;
}

/** Best-effort undo of applyAuth's side-effects when source registration fails. */
async function rollbackAuth(bridge: DesktopBridge, applied: AppliedAuth): Promise<void> {
  if (applied.createdSecretId) {
    await bridge.removeExecutorSecret(applied.createdSecretId).catch(() => {});
  }
  if (applied.oauthNamespace) {
    const connections = await bridge.listExecutorConnections().catch(() => null);
    const connection = findOAuthConnection(connections, applied.oauthNamespace);
    if (connection) await bridge.removeExecutorConnection(connection.id).catch(() => {});
  }
}

/** Register the source itself against executor (auth already applied). */
async function registerSource(
  bridge: DesktopBridge,
  s: SourceSpec,
  headers: Record<string, ConfiguredHeader> | undefined,
): Promise<void> {
  switch (s.type) {
    case "mcp":
      await bridge.addMcpSource({
        transport: "remote",
        name: s.name,
        endpoint: s.endpoint,
        remoteTransport: "auto",
        namespace: s.namespace,
        headers,
      });
      return;
    case "openapi":
      await bridge.addOpenApiSource({
        spec: { kind: "url", url: s.specUrl },
        name: s.name,
        baseUrl: s.baseUrl,
        namespace: s.namespace,
        headers,
      });
      return;
    case "graphql":
      await bridge.addGraphqlSource({
        endpoint: s.endpoint,
        name: s.name,
        namespace: s.namespace,
        headers,
      });
      return;
    case "google":
      // Executor performs the Google OAuth consent lazily in code mode.
      await bridge.addGoogleSource({
        name: s.name,
        discoveryUrl: s.discoveryUrl,
        namespace: s.namespace,
        auth: { kind: "none" },
      });
      return;
  }
}

// Namespaces with an install in flight, so a re-entrant call (e.g. a double
// click before the UI marks the card as connecting) can't race the duplicate
// check and double-register / re-run auth.
const installing = new Set<string>();

/**
 * Register a source against executor, running any auth step first.
 *
 * Refuses up front if the namespace is already taken — re-running auth would
 * overwrite the secret / re-issue the OAuth that the existing source depends on.
 * Because of that check, the only auth side-effects we ever roll back are ones
 * this call just created, so a failed first-time install leaves nothing behind.
 */
export async function installConnector(bridge: DesktopBridge, req: InstallRequest): Promise<void> {
  const namespace = req.source.namespace;
  if (installing.has(namespace)) {
    throw new Error(`An install for "${namespace}" is already in progress.`);
  }
  installing.add(namespace);
  const applied: AppliedAuth = {};
  try {
    if (await namespaceHasSource(bridge, namespace)) {
      throw new Error(`A connector for "${namespace}" is already installed.`);
    }
    await applyAuth(bridge, req, applied);
    await registerSource(bridge, req.source, applied.headers);
  } catch (err) {
    // `applied` is empty if we threw at the duplicate check, so this no-ops then
    // and only undoes side-effects an actual install attempt created.
    await rollbackAuth(bridge, applied);
    throw err;
  } finally {
    installing.delete(namespace);
  }
}

/**
 * Whether a registered source already occupies this namespace. Fails closed: if
 * the source list can't be fetched we can't rule out a duplicate, so the error
 * propagates and the install aborts rather than risk overwriting existing auth.
 */
async function namespaceHasSource(bridge: DesktopBridge, namespace: string): Promise<boolean> {
  const sources = await bridge.listExecutorSources();
  return sources.some((s) => (s.namespace ?? s.id) === namespace);
}

/**
 * Remove a connector's source, its OAuth connection, and any stored secret.
 * Every step is attempted even if an earlier one fails (so a partial failure
 * can't orphan the rest), and the first error is surfaced to the caller.
 */
export async function uninstallConnector(
  bridge: DesktopBridge,
  opts: {
    sourceId?: string;
    namespace: string;
    secretId?: string;
  },
): Promise<void> {
  const errors: unknown[] = [];
  const attempt = async (run: () => Promise<unknown>): Promise<void> => {
    try {
      await run();
    } catch (err) {
      errors.push(err);
    }
  };

  const { sourceId, secretId } = opts;
  let sourceRemoved = true;
  if (sourceId) {
    try {
      await bridge.removeExecutorSource(sourceId);
    } catch (err) {
      errors.push(err);
      sourceRemoved = false;
    }
  }

  // Only tear down the source's auth once the source itself is gone — stripping
  // the OAuth connection / secret while a still-registered source depends on it
  // would break that connector. (With no sourceId we're cleaning up orphans, so
  // proceed.)
  if (sourceRemoved) {
    // Query current connections rather than trusting a possibly-stale snapshot —
    // a connection created earlier in the session may not be in the cached list.
    // Route the fetch through `attempt` so a list failure is recorded (and the
    // partial uninstall surfaced) rather than silently skipping OAuth cleanup.
    let connections: ExecutorConnectionRef[] | null = null;
    await attempt(async () => {
      connections = await bridge.listExecutorConnections();
    });
    const connection = findOAuthConnection(connections, opts.namespace);
    if (connection) await attempt(() => bridge.removeExecutorConnection(connection.id));
    if (secretId) await attempt(() => bridge.removeExecutorSecret(secretId));
  }

  if (errors.length > 0) throw errors[0];
}

/** The stored-secret id for an API-key connector's namespace. */
export function apiKeySecretId(namespace: string): string {
  return `${namespace}_key`;
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
        name: connector.name,
        namespace: connector.id,
        discoveryUrl: install.discoveryUrl,
      },
      auth: { kind: "none" },
    };
  }
  const source: SourceSpec = {
    type: "mcp",
    name: connector.name,
    namespace: connector.id,
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
        prefix: auth.prefix,
        secretId: apiKeySecretId(connector.id),
        secretName: auth.secretLabel,
        secretValue,
      },
    };
  }
  return { source, auth: auth.kind === "oauth" ? { kind: "oauth" } : { kind: "none" } };
}
