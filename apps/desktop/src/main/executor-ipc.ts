// Executor IPC handlers — thin pass-throughs to the executor daemon's HTTP
// client (plus a couple of non-passthroughs for status and open-external).
// Extracted from main/index.ts to keep registerIpcHandlers small.

import { z } from "zod";
import { shell } from "electron";

import { createIpcHandler, createVoidIpcHandler } from "@/main/lib/ipc-handler";
import { getExecutorDaemon } from "@/main/executor/executor-daemon";
import * as executor from "@/main/executor/executor-client";
import {
  AddGoogleSourceInputSchema,
  AddGraphqlSourceInputSchema,
  AddMcpSourceInputSchema,
  AddOpenApiSourceInputSchema,
  OAuthStartInputSchema,
  SetSecretInputSchema,
} from "@/shared/executor";
import { IPC_CHANNELS, isHttpUrl, type ExecutorStatus } from "@/shared/ipc";

export function registerExecutorIpcHandlers(): void {
  // No-arg → client getter.
  const voidForwards: [string, () => unknown][] = [
    [IPC_CHANNELS.EXECUTOR_SOURCES_LIST, executor.listSources],
    [IPC_CHANNELS.EXECUTOR_SECRETS_LIST, executor.listSecrets],
    [IPC_CHANNELS.EXECUTOR_CONNECTIONS_LIST, executor.listConnections],
  ];
  for (const [channel, fn] of voidForwards) createVoidIpcHandler(channel, fn);

  // Single string arg (id / url / sessionId).
  const stringForwards: [string, (arg: string) => unknown][] = [
    [IPC_CHANNELS.EXECUTOR_SOURCES_DETECT, executor.detectSource],
    [IPC_CHANNELS.EXECUTOR_SOURCE_REMOVE, executor.removeSource],
    [IPC_CHANNELS.EXECUTOR_SOURCE_REFRESH, executor.refreshSource],
    [IPC_CHANNELS.EXECUTOR_SECRET_REMOVE, executor.removeSecret],
    [IPC_CHANNELS.EXECUTOR_CONNECTION_REMOVE, executor.removeConnection],
    [IPC_CHANNELS.EXECUTOR_OAUTH_AWAIT, executor.awaitOAuth],
  ];
  for (const [channel, fn] of stringForwards) createIpcHandler(channel, z.string(), fn);

  createIpcHandler(
    IPC_CHANNELS.EXECUTOR_SOURCE_ADD_MCP,
    AddMcpSourceInputSchema,
    executor.addMcpSource,
  );
  createIpcHandler(
    IPC_CHANNELS.EXECUTOR_SOURCE_ADD_OPENAPI,
    AddOpenApiSourceInputSchema,
    executor.addOpenApiSource,
  );
  createIpcHandler(
    IPC_CHANNELS.EXECUTOR_SOURCE_ADD_GRAPHQL,
    AddGraphqlSourceInputSchema,
    executor.addGraphqlSource,
  );
  createIpcHandler(
    IPC_CHANNELS.EXECUTOR_SOURCE_ADD_GOOGLE,
    AddGoogleSourceInputSchema,
    executor.addGoogleSource,
  );
  createIpcHandler(IPC_CHANNELS.EXECUTOR_SECRET_SET, SetSecretInputSchema, executor.setSecret);
  createIpcHandler(IPC_CHANNELS.EXECUTOR_OAUTH_START, OAuthStartInputSchema, executor.oauthStart);

  // The two non-passthrough handlers stay explicit.
  createVoidIpcHandler(IPC_CHANNELS.EXECUTOR_STATUS, (): ExecutorStatus => {
    // Scope is immutable for the daemon's life and cached on the connection,
    // so there's no need for a live /scope round-trip here.
    const conn = getExecutorDaemon().getConnection();
    return conn ? { running: true, scope: conn.scope } : { running: false };
  });

  createIpcHandler(IPC_CHANNELS.EXECUTOR_OPEN_EXTERNAL, z.string(), (url) => {
    // Throw on a non-http(s) URL so the renderer surfaces it immediately,
    // rather than silently no-op'ing and leaving an OAuth flow to time out.
    if (!isHttpUrl(url)) throw new Error(`refusing to open non-http URL: ${url}`);
    void shell.openExternal(url);
  });
}
