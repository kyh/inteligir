// Executor IPC handlers — thin pass-throughs to the executor daemon's HTTP
// client (plus a couple of non-passthroughs for status and open-external).

import { shell } from "electron";

import { handle } from "@/main/lib/ipc-handler";
import { getExecutorDaemon } from "@/main/executor/executor-daemon";
import * as executor from "@/main/executor/executor-client";
import { isHttpUrl, type ExecutorStatus } from "@/shared/ipc";

export function registerExecutorIpcHandlers(): void {
  handle("listExecutorSources", executor.listSources);
  handle("listExecutorSecrets", executor.listSecrets);
  handle("listExecutorConnections", executor.listConnections);

  handle("detectExecutorSource", executor.detectSource);
  handle("removeExecutorSource", executor.removeSource);
  handle("refreshExecutorSource", executor.refreshSource);
  handle("removeExecutorSecret", executor.removeSecret);
  handle("removeExecutorConnection", executor.removeConnection);
  handle("executorOAuthAwait", executor.awaitOAuth);

  handle("addMcpSource", executor.addMcpSource);
  handle("addOpenApiSource", executor.addOpenApiSource);
  handle("addGraphqlSource", executor.addGraphqlSource);
  handle("addGoogleSource", executor.addGoogleSource);
  handle("setExecutorSecret", executor.setSecret);
  handle("executorOAuthStart", executor.oauthStart);

  handle("executorStatus", (): ExecutorStatus => {
    // Scope is immutable for the daemon's life and cached on the connection,
    // so there's no need for a live /scope round-trip here.
    const conn = getExecutorDaemon().getConnection();
    return conn ? { running: true, scope: conn.scope } : { running: false };
  });

  handle("executorOpenExternal", async (url) => {
    // Throw on a non-http(s) URL so the renderer surfaces it immediately,
    // rather than silently no-op'ing and leaving an OAuth flow to time out.
    if (!isHttpUrl(url)) throw new Error(`refusing to open non-http URL: ${url}`);
    // Await so a browser-launch failure rejects to the renderer (which fails the
    // OAuth flow fast) instead of being swallowed.
    await shell.openExternal(url);
  });
}
