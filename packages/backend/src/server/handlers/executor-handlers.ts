// Executor handlers — thin pass-throughs to the executor daemon's HTTP
// client (plus a couple of non-passthroughs for status and open-external),
// and the host-orchestrated connector install/uninstall flows.

import {
  getPendingConnectorAuth,
  installConnector,
  uninstallConnector,
  type ConnectorInstallOps,
} from "../connectors/connector-install";
import {
  applyGoogleEndpointOverride,
  emulatePlaceholderGoogleClient,
  isEmulateConnectorsEnabled,
} from "../connectors/emulate-connectors";
import * as executor from "../connectors/executor-client";
import { getExecutorDaemon } from "../connectors/executor-daemon";
import { ensureGoogleOAuthClient, getBundledGoogleClient } from "../connectors/google-oauth-client";
import type { HandlerRegistrar } from "./handler-registry";
import { getHostOptions, getPlatform } from "../platform-instance";
import { isHttpUrl } from "@repo/bridge/wire-helpers";
import type { ExecutorStatus } from "@repo/bridge/ipc-registry";

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
  // Dev-only (#462): the E2E drive polls this for the in-flight OAuth consent
  // instead of reading the daemon's SQLite. Refused outright outside emulate
  // mode (and emulate itself is refused in packaged builds — dev-flags.ts).
  handle("getPendingConnectorAuth", () => {
    if (!isEmulateConnectorsEnabled()) {
      throw new Error("getPendingConnectorAuth requires INTELIGIR_EMULATE_CONNECTORS=1");
    }
    return getPendingConnectorAuth();
  });

  handle("listExecutorIntegrations", executor.listIntegrations);
  handle("detectExecutorIntegration", executor.detectIntegration);
  handle("listExecutorConnections", executor.listConnections);

  // applyGoogleEndpointOverride: a production no-op; under the Phase 4b
  // emulate/env dev override it swaps the baked real-Google endpoints the
  // renderer's GCP dialog passes for the resolved ones (emulate-connectors.ts).
  handle("createExecutorOAuthClient", (input) =>
    executor.createOAuthClient(applyGoogleEndpointOverride(input)),
  );
  // Seeds the build's bundled Google client into executor when no "google"
  // client is registered yet (never overwrites one) so the renderer can go
  // straight to consent instead of asking for a GCP app. Under the emulate
  // dev flag, placeholder credentials stand in when no bundled/env client
  // exists (emulate accepts any client id/secret) — real credentials win.
  handle("ensureGoogleOAuthClient", () =>
    ensureGoogleOAuthClient(
      executor,
      getBundledGoogleClient(getHostOptions().bundledGoogleClient) ??
        emulatePlaceholderGoogleClient(),
    ),
  );

  handle("executorStatus", (): ExecutorStatus => {
    // The redirect URI is fixed for the daemon's life and cached on the
    // connection, so there's no need for a live round-trip here.
    const conn = getExecutorDaemon().getConnection();
    return conn ? { running: true, redirectUri: conn.redirectUri } : { running: false };
  });
}
