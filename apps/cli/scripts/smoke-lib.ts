// Shared by the CLI and desktop smokes, which boot different artifacts of the same server.
// A workspace seam only: `publishConfig.exports` drops it from the published package.

import { spawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { RPC_PREFIX } from "@repo/contract/local/routes";
import { z } from "zod";

const WATCHER_TIMEOUT_MS = 20_000;
// src/server/server-file.ts owns the name, but a script cannot import it: node's type stripping
// resolves no extensionless import, and that module's imports name no extension
const SERVER_FILE_NAME = "server.json";

// always throws, after marking the run failed, so the throw unwinds to the smoke's cleanup; typed
// on the binding so a call narrows what follows it
export const fail: (message: string) => never = (message) => {
  process.stderr.write(`smoke: ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
};

export const log = (line: string): void => {
  process.stdout.write(`smoke: ${line}\n`);
};

export interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

// rejects on "error", as "close" never fires for a spawn that failed; `events.once` would answer
// the same untyped
export const exitOf = async (child: ChildProcess): Promise<Exit> =>
  // oxlint-disable-next-line promise/avoid-new -- bridges the child's "close" and "error" events
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      child.off("error", reject);
      resolve({ code, signal });
    });
  });

interface Ran {
  stderr: string;
  stdout: string;
}

export const run = async (
  file: string,
  argv: readonly string[],
  options: SpawnOptions = {},
): Promise<Ran> => {
  const child = spawn(file, argv, { stdio: ["ignore", "pipe", "pipe"], ...options });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const { code } = await exitOf(child);
  if (code !== 0) {
    throw new Error(`${file} ${argv.join(" ")} exited ${code}\n${stdout}\n${stderr}`);
  }
  return { stderr, stdout };
};

export const waitForUrl = async (url: string, deadlineMs: number): Promise<Response | null> => {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        return response;
      }
    } catch {
      // a refused connection or a timeout is just "not up yet"
    }
    if (Date.now() > deadline) {
      return null;
    }
    await delay(250);
  }
};

const serverFileSchema = z.object({ token: z.string().min(1) });

// the bearer the data dir's server published once it listened
export const readServerToken = (dataDir: string): string =>
  serverFileSchema.parse(JSON.parse(readFileSync(path.join(dataDir, SERVER_FILE_NAME), "utf-8")))
    .token;

type Json = boolean | number | string | null | readonly Json[] | { readonly [key: string]: Json };

// `answer` parses the fields of the procedure's answer the caller reads, and no more
export type Rpc = <T>(procedure: string, answer: z.ZodType<T>, input?: Json) => Promise<T>;

// every procedure answers an object; this one is for the answer a caller does not read
export const unreadAnswer = z.object({});

// hand-rolled: the typed client needs a bundler the smokes do not have
export const rpcClient =
  (baseUrl: string, token: string): Rpc =>
  async (procedure, answer, input) => {
    const response = await fetch(`${baseUrl}${RPC_PREFIX}/${procedure}`, {
      body: input === undefined ? "{}" : JSON.stringify({ json: input }),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      method: "POST",
    });
    if (!response.ok) {
      fail(`${procedure} answered ${response.status}`);
    }
    return z.object({ json: answer }).parse(await response.json()).json;
  };

const searchAnswerSchema = z.object({ results: z.array(z.unknown()) });

// the watcher is a forked child its proxy respawns forever, so a child that cannot load its
// platform binding never reaches the server's status; an external write reaching the index is
// the only proof it lives. Written again on each round: the first can land before the child's
// first subscribe.
export const proveWatcherAlive = async (rpc: Rpc, vaultDir: string): Promise<void> => {
  const token = `smokewatch${Date.now()}`;
  const note = path.join(vaultDir, "Smoke Watch.md");
  const deadline = Date.now() + WATCHER_TIMEOUT_MS;
  let seen = false;
  for (let round = 0; !seen && Date.now() < deadline; round += 1) {
    writeFileSync(note, `# Smoke Watch\n\n${token} round ${round}\n`);
    for (let poll = 0; poll < 10 && !seen; poll += 1) {
      await delay(500);
      const found = await rpc("knowledge/search", searchAnswerSchema, { q: token });
      seen = found.results.length > 0;
    }
  }
  if (!seen) {
    fail(
      `the vault watcher never reported an external write to ${note} within ${WATCHER_TIMEOUT_MS}ms — ` +
        "the forked child is not watching (is @parcel/watcher's platform package in the tree?)",
    );
  }
  log("the watcher reported an external write");
};
