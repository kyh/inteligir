// Executor handlers — thin pass-throughs to the executor daemon's HTTP
// client (plus a couple of non-passthroughs for status and open-external).

import * as executor from "../executor/executor-client";
import { getExecutorDaemon } from "../executor/executor-daemon";
import { ensureGoogleOAuthClient, getBundledGoogleClient } from "../executor/google-oauth-client";
import type { HandlerRegistrar } from "../lib/handler-registry";
import { getHostOptions, getPlatform } from "../platform-instance";
import { isHttpUrl, type ExecutorStatus } from "@repo/core/ipc";

export function registerExecutorHandlers(handle: HandlerRegistrar): void {
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
