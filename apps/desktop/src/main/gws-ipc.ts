// gws (Google Workspace CLI) auth IPC. The connector catalog surfaces Google
// as a card; its connect/disconnect actions drive `gws auth {login,logout}` and
// its connected state comes from `gws auth status`. Executor doesn't yet have a
// working Google OAuth path, so gws stays the Google integration.

import { z } from "zod";
import { runCli } from "@repo/agent-runtime/run-cli";

import { createIpcHandler } from "@/main/lib/ipc-handler";
import { inteligirPath } from "@/main/lib/json-store";
import { IPC_CHANNELS, type GwsAuthResult } from "@/shared/ipc";

const GWS_BIN = inteligirPath("bin", "gws");
const STATUS_TIMEOUT_MS = 15_000;
// `gws auth login` opens a browser and blocks until the callback fires.
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const MAX_BUFFER = 1024 * 1024;

const GwsAuthActionSchema = z.enum(["status", "login", "logout"]);

/**
 * `gws auth status` exits 0 when an account is authenticated and non-zero
 * otherwise — that exit code is the signal we trust. A negative-text guard
 * catches the case where the CLI still exits 0 but reports no active account.
 */
function isAuthenticated(stdout: string, stderr: string, code: number): boolean {
  if (code !== 0) return false;
  const text = `${stdout}\n${stderr}`.toLowerCase();
  return !/not\s+authenticat|no\s+(active\s+)?account|logged\s+out|please\s+(run\s+)?.*login|sign\s+in/.test(
    text,
  );
}

export function registerGwsIpcHandlers(): void {
  createIpcHandler(
    IPC_CHANNELS.GWS_AUTH,
    GwsAuthActionSchema,
    async (action): Promise<GwsAuthResult> => {
      const args = action === "status" ? ["auth", "status"] : ["auth", action];
      const timeoutMs = action === "login" ? LOGIN_TIMEOUT_MS : STATUS_TIMEOUT_MS;
      try {
        const result = await runCli(GWS_BIN, args, {
          timeoutMs,
          maxBuffer: MAX_BUFFER,
          notFoundMessage: "Google Workspace CLI is not installed yet.",
        });
        // After logout there is deliberately no account; report disconnected
        // without re-running status.
        if (action === "logout") return { authenticated: false };
        return { authenticated: isAuthenticated(result.stdout, result.stderr, result.code) };
      } catch (err) {
        return {
          authenticated: false,
          error: err instanceof Error ? err.message : "gws auth failed",
        };
      }
    },
  );
}
