// a verb against the real composition, over the transport the binary uses: the booted app listens
// on loopback, its data dir holds the server.json every verb reads, and each run resolves the
// server from that file and sends its bearer. What a case needs the server to hold first, it puts
// there through the server's own services.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { RPC_PREFIX } from "@repo/contract/local/routes";
import { beginAgentTurnWrites } from "../server/agents/agent-commits";
import { awaitThreadStatus } from "../server/agents/test-support/agent-test-harness";
import { ERROR_STATUS_MAP } from "../server/error-status";
import { closeServer } from "../server/listen";
import { localRouter } from "../server/root-router";
import { loopbackOrigin, writeServerFile } from "../server/server-file";
import {
  listenTestApp,
  makeTempDir,
  TEST_SERVER_TOKEN,
  TEST_SERVER_VERSION,
} from "../server/test-support/boot-app";
import type { TempDirOptions } from "../server/test-support/temp-dir";
import type { BootedTestApp, ThreadHarness } from "../server/test-support/boot-app";
import { runCliForTest } from "./run-cli";
import type { CliRunResult, RunOptions } from "./run-cli";

const VAULT_READ_PATH = `${RPC_PREFIX}/vault/read`;

// a built page for a server to serve, so it mints the browser handoff `open` asks for
export const pageBundle = (options?: TempDirOptions): string => {
  const dir = makeTempDir("inteligir-cli-page-", options);
  writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>inteligir</title>\n");
  return dir;
};

interface Refusal {
  code: "BAD_REQUEST" | "INTERNAL_SERVER_ERROR";
  message: string;
}

export interface CliOverServer<App extends BootedTestApp> {
  app: App;
  baseUrl: string;
  cli: (argv: readonly string[], options?: RunOptions) => Promise<CliRunResult>;
  // a vault file's bytes as the disk holds them, or null where nothing is
  onDisk: (vaultPath: string) => string | null;
  // written through the server, so the index and the auto-commit see them as any write
  put: (files: Record<string, string>) => Promise<void>;
  // another writer's bytes, landed on disk just after the server answers the next read of that
  // path: the race a guarded write exists to refuse
  landAfterNextRead: (vaultPath: string, content: string) => void;
  // every call refused with this class by the real router's own handler, before any procedure
  // runs, as no real state refuses every route at once; null answers them again
  refuseEveryCall: (refusal: Refusal | null) => void;
  // the listener closed with its server.json left behind, as a crash leaves it
  stopListening: () => Promise<void>;
}

export const cliOver = async <App extends BootedTestApp>(app: App): Promise<CliOverServer<App>> => {
  const context = { ...app.composed.context, agentThreadId: null };
  let refusal: Refusal | null = null;
  const refusing = new RPCHandler(localRouter, {
    clientInterceptors: [
      () => {
        throw new ORPCError(refusal?.code ?? "INTERNAL_SERVER_ERROR", {
          message: refusal?.message ?? "refused",
        });
      },
    ],
    errorStatusMap: ERROR_STATUS_MAP,
  });
  const lands = new Map<string, string>();

  const { port, server } = await listenTestApp(app, {
    around: async (request, answer) => {
      const { pathname } = new URL(request.url);
      if (refusal !== null && pathname.startsWith(`${RPC_PREFIX}/`)) {
        const { response } = await refusing.handle(request, { context, prefix: RPC_PREFIX });
        return response ?? new Response("Not found", { status: 404 });
      }
      if (lands.size === 0 || pathname !== VAULT_READ_PATH) {
        return await answer(request);
      }
      const asked = await request.clone().text();
      const response = await answer(request);
      for (const [vaultPath, content] of lands) {
        if (asked.includes(JSON.stringify(vaultPath))) {
          lands.delete(vaultPath);
          await writeFile(path.join(app.vaultDir, vaultPath), content);
        }
      }
      return response;
    },
  });
  writeServerFile(app.dataDir, {
    pid: process.pid,
    port,
    token: TEST_SERVER_TOKEN,
    vaultDir: app.vaultDir,
    version: TEST_SERVER_VERSION,
  });

  return {
    app,
    baseUrl: loopbackOrigin(port),
    cli: async (argv, options = {}) =>
      await runCliForTest({
        ...options,
        argv: [...argv],
        cliVersion: TEST_SERVER_VERSION,
        dataDir: app.dataDir,
      }),
    landAfterNextRead: (vaultPath, content) => {
      lands.set(vaultPath, content);
    },
    onDisk: (vaultPath) => {
      const absolute = path.join(app.vaultDir, vaultPath);
      return existsSync(absolute) ? readFileSync(absolute, "utf-8") : null;
    },
    put: async (files) => {
      for (const [vaultPath, content] of Object.entries(files)) {
        await app.client.vault.write({ content, guard: { kind: "overwrite" }, path: vaultPath });
      }
    },
    refuseEveryCall: (next) => {
      refusal = next;
    },
    stopListening: async () => {
      await closeServer(server, app.composed.upgradedSockets);
    },
  };
};

// one turn of the action that wrote `files` the way an agent's own tools do: started through the
// server, each write joined to the turn's commit, and ended completed, so what the action changed
// and its Undo are the server's own
export const agentTurn = async (
  app: ThreadHarness,
  threadId: string,
  files: Record<string, string>,
): Promise<string> => {
  const sent = await app.client.threads.send({ text: "edit my notes", threadId });
  if (sent.kind !== "started") {
    throw new Error(`expected the send to start a turn, got ${sent.kind}`);
  }
  const writes = beginAgentTurnWrites({
    git: app.vault.git,
    notifier: app.bus,
    threadId,
    turnId: sent.turnId,
  });
  await writes.ready;
  for (const [vaultPath, content] of Object.entries(files)) {
    const written = await app.vault.service.write(vaultPath, content);
    writes.recordPaths([written.path]);
  }
  await writes.finish();
  app.driver.completeTurn(threadId, sent.turnId, "completed");
  await awaitThreadStatus(app.client, threadId, "idle");
  return sent.turnId;
};
