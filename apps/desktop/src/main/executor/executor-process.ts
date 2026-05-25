// ---------------------------------------------------------------------------
// Executor process manager.
//
// Runs a single `executor mcp` child process (https://executor.sh) and keeps a
// connected MCP client to it. Executor is the integration layer / MCP client:
// it owns the catalog of "sources" (remote MCP servers, etc.) and exposes a
// sandboxed code-mode `execute` tool. Inteligir connects to it over stdio and
// surfaces `execute` (+ `resume`) to the agent as pi tools.
//
// Configured MCP connectors (see mcp-servers.ts / ~/.inteligir/mcp.json) are
// reconciled into executor's catalog as MCP sources via the live client, so
// the code-mode sandbox can reach them. Adding a source triggers a one-shot
// approval elicitation which we auto-accept (the user already opted in by
// adding the connector in Settings).
//
// State (catalog + OAuth tokens) persists under ~/.inteligir/executor so a
// fixed scope/data dir is shared across restarts.
// ---------------------------------------------------------------------------

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { inteligirPath } from "@/main/lib/json-store";
import { getMcpServers } from "@/main/mcp/mcp-servers";
import { mcpServerSlug, type McpServer } from "@/shared/mcp";

const EXECUTOR_DIR = inteligirPath("executor");
const DATA_DIR = path.join(EXECUTOR_DIR, "data");
const SCOPE_DIR = path.join(EXECUTOR_DIR, "scope");

const CONNECT_TIMEOUT_MS = 30_000;
const CALL_TIMEOUT_MS = 120_000;
const MAX_RESUME_HOPS = 5;

type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type ExecutorToolResult = { content: ToolContent[]; details: Record<string, never> };

class ExecutorProcess {
  private client: Client | null = null;
  private starting: Promise<Client | null> | null = null;

  /** Idempotent. Returns the connected client, or null if executor is unavailable. */
  async start(): Promise<Client | null> {
    if (this.client) return this.client;
    if (this.starting) return this.starting;
    this.starting = this.spawnAndConnect()
      .then((client) => {
        this.client = client;
        return client;
      })
      .catch((err) => {
        console.error("[executor] failed to start:", err instanceof Error ? err.message : err);
        return null;
      })
      .finally(() => {
        this.starting = null;
      });
    return this.starting;
  }

  getClient(): Client | null {
    return this.client;
  }

  async stop(): Promise<void> {
    const client = this.client;
    this.client = null;
    await client?.close().catch(() => {});
  }

  private async spawnAndConnect(): Promise<Client> {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(SCOPE_DIR, { recursive: true });

    const { command, prefixArgs, runAsNode } = resolveExecutorCommand();
    const transport = new StdioClientTransport({
      command,
      args: [...prefixArgs, "mcp", "--scope", SCOPE_DIR, "--elicitation-mode", "model"],
      env: {
        ...(process.env as Record<string, string>),
        EXECUTOR_DATA_DIR: DATA_DIR,
        EXECUTOR_SCOPE_DIR: SCOPE_DIR,
        ...(runAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
      },
      stderr: "ignore",
    });

    const client = new Client({ name: "inteligir", version: "1.0.0" });
    await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, "connect to executor");
    // Reconcile connectors in the background — addSource does network-bound
    // discovery, so don't block agent startup on it. Sources persist in
    // executor's catalog, so this is a no-op fast path after the first run.
    void this.reconcile(client).catch((err) => console.error("[executor] reconcile failed:", err));
    return client;
  }

  /**
   * Bring executor's MCP sources in line with the enabled connectors in
   * mcp.json: add any that are missing, remove any executor MCP source that's
   * no longer configured. Safe to call on a live client; no-op if executor
   * isn't running.
   */
  async reconcile(client: Client | null = this.client): Promise<void> {
    if (!client) return;
    const desired = getMcpServers().listEnabled();
    const desiredNamespaces = new Map(desired.map((s) => [mcpServerSlug(s.name), s]));

    let existing: ExecutorSource[];
    try {
      existing = await this.listSources(client);
    } catch (err) {
      console.error("[executor] reconcile: failed to list sources:", err);
      return;
    }
    const existingMcp = existing.filter((s) => s.kind === "mcp");
    const existingIds = new Set(existingMcp.map((s) => s.id));

    for (const [namespace, server] of desiredNamespaces) {
      if (!existingIds.has(namespace)) {
        await this.addSource(client, server, namespace).catch((err) =>
          console.error(`[executor] failed to add source "${server.name}":`, err),
        );
      }
    }

    for (const source of existingMcp) {
      if (!desiredNamespaces.has(source.id)) {
        await this.removeSource(client, source.id).catch((err) =>
          console.error(`[executor] failed to remove source "${source.id}":`, err),
        );
      }
    }
  }

  private async listSources(client: Client): Promise<ExecutorSource[]> {
    const text = await runCode(
      client,
      `const s = await tools.executor.sources.list();
       return s.items.map((x) => ({ id: x.id, kind: x.kind }));`,
    );
    const parsed: unknown = safeJson(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is ExecutorSource =>
        typeof x === "object" &&
        x !== null &&
        typeof (x as ExecutorSource).id === "string" &&
        typeof (x as ExecutorSource).kind === "string",
    );
  }

  private async addSource(client: Client, server: McpServer, namespace: string): Promise<void> {
    const args = {
      transport: "remote",
      name: server.name,
      endpoint: server.url,
      remoteTransport: "auto",
      namespace,
      ...(server.headers && Object.keys(server.headers).length > 0
        ? { headers: server.headers }
        : {}),
    };
    await runCode(
      client,
      `return await tools.executor.mcp.addSource(${JSON.stringify(args)});`,
    );
  }

  private async removeSource(client: Client, id: string): Promise<void> {
    // Executor exposes source removal under coreTools; the exact path can vary
    // across versions, so try the known shapes and ignore failures.
    await runCode(
      client,
      `const id = ${JSON.stringify(id)};
       const fns = [
         () => tools.executor.coreTools.removeSource({ sourceId: id }),
         () => tools.executor.coreTools.removeSource({ id }),
         () => tools.executor.sources.remove({ sourceId: id }),
       ];
       for (const fn of fns) { try { return await fn(); } catch (e) {} }
       return "no-op";`,
    );
  }
}

type ExecutorSource = { id: string; kind: string };

let _instance: ExecutorProcess | null = null;

export function getExecutorProcess(): ExecutorProcess {
  if (!_instance) _instance = new ExecutorProcess();
  return _instance;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run a snippet through executor's `execute` tool, auto-accepting any approval
 * elicitations (used for host-driven source management — the user already
 * consented by configuring the connector). Returns the final text output.
 */
async function runCode(client: Client, code: string): Promise<string> {
  let result = await client.callTool({ name: "execute", arguments: { code } }, undefined, {
    timeout: CALL_TIMEOUT_MS,
  });
  let text = contentText(result.content);

  for (let hop = 0; hop < MAX_RESUME_HOPS && isPaused(text); hop++) {
    const executionId = text.match(/exec_[0-9]+/)?.[0];
    if (!executionId) break;
    result = await client.callTool(
      { name: "resume", arguments: { executionId, action: "accept", content: "{}" } },
      undefined,
      { timeout: CALL_TIMEOUT_MS },
    );
    text = contentText(result.content);
  }
  return text;
}

function isPaused(text: string): boolean {
  return text.includes("Execution paused") || text.includes("executionId");
}

function contentText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (c): c is { type: "text"; text: string } =>
        typeof c === "object" && c !== null && (c as { type?: string }).type === "text",
    )
    .map((c) => c.text)
    .join("");
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out: ${label} (${ms}ms)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Resolve how to launch executor. Executor ships per-platform standalone
 * binaries via optional dependencies (`executor-<platform>-<arch>`); prefer
 * running that binary directly. Fall back to the JS launcher run under
 * Electron-as-node when the platform binary can't be located.
 */
function resolveExecutorCommand(): { command: string; prefixArgs: string[]; runAsNode: boolean } {
  const require = createRequire(import.meta.url);
  const launcherPkg = require.resolve("executor/package.json");
  const launcherDir = path.dirname(launcherPkg);

  const platform = { darwin: "darwin", linux: "linux", win32: "windows" }[process.platform] ?? process.platform;
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : process.arch;
  const binName = process.platform === "win32" ? "executor.exe" : "executor";
  const pkgNames = [`executor-${platform}-${arch}`, `executor-${platform}-${arch}-musl`];

  // node_modules roots to search for the per-platform binary package:
  //  - the launcher's own dir (pnpm nests platform deps as siblings here)
  //  - the packaged app's unpacked node_modules (top-level, hoisted via the
  //    app's optionalDependencies)
  const roots = [path.dirname(launcherDir)];
  if (process.resourcesPath) {
    roots.push(path.join(process.resourcesPath, "app.asar.unpacked", "node_modules"));
  }

  for (const root of roots) {
    for (const pkg of pkgNames) {
      const candidate = path.join(root, pkg, "bin", binName);
      if (fs.existsSync(candidate)) {
        return { command: candidate, prefixArgs: [], runAsNode: false };
      }
    }
  }

  // Fall back to the JS launcher executed by Electron's bundled Node.
  return {
    command: process.execPath,
    prefixArgs: [path.join(launcherDir, "bin", "executor")],
    runAsNode: true,
  };
}

export { DATA_DIR as EXECUTOR_DATA_DIR, SCOPE_DIR as EXECUTOR_SCOPE_DIR };
