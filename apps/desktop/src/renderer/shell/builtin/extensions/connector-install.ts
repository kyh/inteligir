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
export type AuthSpec =
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

/** The OAuth connection for a namespace, if any (matched by id or provider). */
export function findOAuthConnection(
  connections: ExecutorConnectionRef[] | null,
  namespace: string,
): ExecutorConnectionRef | undefined {
  return (connections ?? []).find(
    (c) => c.id === oauthConnectionId(namespace) || c.provider === namespace,
  );
}

/** Run the auth side-effects (OAuth / secret) and return the headers to register with. */
async function applyAuth(
  bridge: DesktopBridge,
  req: InstallRequest,
): Promise<Record<string, ConfiguredHeader> | undefined> {
  const headers: Record<string, ConfiguredHeader> = { ...req.headers };
  if (req.auth.kind === "oauth") {
    if (req.source.type !== "mcp") throw new Error("OAuth is only supported for MCP sources.");
    await runOAuthFlow(bridge, req.source.endpoint, oauthConnectionId(req.source.namespace));
  } else if (req.auth.kind === "apiKey") {
    await bridge.setExecutorSecret({
      id: req.auth.secretId,
      name: req.auth.secretName,
      value: req.auth.secretValue,
      provider: req.source.namespace,
    });
    headers[req.auth.headerName] = { secretId: req.auth.secretId, prefix: req.auth.prefix };
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

/** Register a source against executor, running any auth step first. */
export async function installConnector(bridge: DesktopBridge, req: InstallRequest): Promise<void> {
  const headers = await applyAuth(bridge, req);
  const s = req.source;
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

/** Remove a connector's source, its OAuth connection, and any stored secret. */
export async function uninstallConnector(
  bridge: DesktopBridge,
  opts: {
    sourceId?: string;
    namespace: string;
    connections: ExecutorConnectionRef[] | null;
    secretId?: string;
  },
): Promise<void> {
  if (opts.sourceId) await bridge.removeExecutorSource(opts.sourceId);
  const connection = findOAuthConnection(opts.connections, opts.namespace);
  if (connection) await bridge.removeExecutorConnection(connection.id);
  if (opts.secretId) await bridge.removeExecutorSecret(opts.secretId);
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
    return {
      source,
      auth: {
        kind: "apiKey",
        headerName: auth.headerName,
        prefix: auth.prefix,
        secretId: apiKeySecretId(connector.id),
        secretName: auth.secretLabel,
        secretValue: secretValue ?? "",
      },
    };
  }
  return { source, auth: auth.kind === "oauth" ? { kind: "oauth" } : { kind: "none" } };
}
