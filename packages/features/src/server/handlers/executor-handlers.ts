// Executor handlers — thin pass-throughs to the executor daemon's HTTP
// client (plus a couple of non-passthroughs for status and open-external),
// and the host-orchestrated connector install/uninstall flows.

import {
  installConnector,
  uninstallConnector,
  type ConnectorInstallOps,
} from "../executor/connector-install";
import * as executor from "../executor/executor-client";
import { getExecutorDaemon } from "../executor/executor-daemon";
import { ensureGoogleOAuthClient, getBundledGoogleClient } from "../executor/google-oauth-client";
import type { HandlerRegistrar } from "../lib/handler-registry";
import { getHostOptions, getPlatform } from "../platform-instance";
import { isHttpUrl } from "@repo/features/ipc";
import type { ExecutorStatus } from "@repo/features/ipc-registry";

// The real ports the connector orchestration runs on: the executor-client 1:1,
// the platform browser-open (same non-http refusal as executorOpenExternal),
// and a real-time delay for the OAuth await poll.
const connectorOps: ConnectorInstallOps = {
  listIntegrations: executor.listIntegrations,
  removeIntegration: executor.removeIntegration,
  addMcpIntegration: executor.addMcpIntegration,
  addOpenApiIntegration: executor.addOpenApiIntegration,
  addGraphqlIntegration: executor.addGraphqlIntegration,
  listConnections: executor.listConnections,
  createConnection: executor.createConnection,
  removeConnection: executor.removeConnection,
  listOAuthClients: executor.listOAuthClients,
  registerOAuthClientDynamic: executor.registerOAuthClientDynamic,
  oauthProbe: executor.oauthProbe,
  oauthStart: executor.oauthStart,
  awaitOAuth: executor.awaitOAuth,
  openExternal: async (url) => {
    // Throw on a non-http(s) URL so the install fails fast (and the renderer
    // sees the message) rather than an OAuth flow silently timing out.
    if (!isHttpUrl(url)) throw new Error(`refusing to open non-http URL: ${url}`);
    await getPlatform().openExternal(url);
  },
  waitMs: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export function registerExecutorHandlers(handle: HandlerRegistrar): void {
  handle("installConnector", (req) => installConnector(connectorOps, req));
  handle("uninstallConnector", (req) => uninstallConnector(connectorOps, req));

  handle("listExecutorIntegrations", executor.listIntegrations);
  handle("detectExecutorIntegration", executor.detectIntegration);
  handle("removeExecutorIntegration", executor.removeIntegration);

  handle("addMcpIntegration", executor.addMcpIntegration);
  handle("addOpenApiIntegration", executor.addOpenApiIntegration);
  handle("addGraphqlIntegration", executor.addGraphqlIntegration);

  handle("listExecutorConnections", executor.listConnections);
  handle("createExecutorConnection", executor.createConnection);
  handle("removeExecutorConnection", executor.removeConnection);

  handle("listExecutorOAuthClients", executor.listOAuthClients);
  handle("createExecutorOAuthClient", executor.createOAuthClient);
  // Seeds the build's bundled Google client into executor when no "google"
  // client is registered yet (never overwrites one) so the renderer can go
  // straight to consent instead of asking for a GCP app.
  handle("ensureGoogleOAuthClient", () =>
    ensureGoogleOAuthClient(executor, getBundledGoogleClient(getHostOptions().bundledGoogleClient)),
  );
  handle("registerExecutorOAuthClientDynamic", executor.registerOAuthClientDynamic);
  handle("executorOAuthProbe", executor.oauthProbe);
  handle("executorOAuthStart", executor.oauthStart);
  handle("executorOAuthAwait", executor.awaitOAuth);

  handle("executorStatus", (): ExecutorStatus => {
    // The redirect URI is fixed for the daemon's life and cached on the
    // connection, so there's no need for a live round-trip here.
    const conn = getExecutorDaemon().getConnection();
    return conn ? { running: true, redirectUri: conn.redirectUri } : { running: false };
  });

  handle("executorOpenExternal", async (url) => {
    // Throw on a non-http(s) URL so the renderer surfaces it immediately,
    // rather than silently no-op'ing and leaving an OAuth flow to time out.
    if (!isHttpUrl(url)) throw new Error(`refusing to open non-http URL: ${url}`);
    // Await so a browser-launch failure rejects to the renderer (which fails the
    // OAuth flow fast) instead of being swallowed.
    await getPlatform().openExternal(url);
  });
}
