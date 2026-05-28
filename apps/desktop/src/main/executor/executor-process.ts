// ---------------------------------------------------------------------------
// Executor process manager.
//
// Runs a single `executor mcp` child process (https://executor.sh) and keeps a
// connected MCP client to it. Executor is the integration layer / MCP client:
// it owns the catalog of "sources" (remote MCP servers, etc.) and exposes a
// sandboxed code-mode `execute` tool. Inteligir connects to it over stdio and
// surfaces `execute` (+ `resume`) to the agent as pi tools.
//
// The binary is installed from executor's GitHub release into
// ~/.inteligir/executor/bin during the extension's setup() — same mechanism
// (@repo/agent-runtime) the browser/gws/peekaboo CLIs use, rather than being
// bundled into the app.
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

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { installCliFromGithubRelease } from "@repo/agent-runtime/install";

import { JsonStore, inteligirPath } from "@/main/lib/json-store";
import { getMcpServers } from "@/main/mcp/mcp-servers";
import { mcpServerSlug, type McpServer } from "@/shared/mcp";
import { z } from "zod";

const EXECUTOR_VERSION = "1.4.33";
const EXECUTOR_DIR = inteligirPath("executor");
const BIN_DIR = path.join(EXECUTOR_DIR, "bin");
const DATA_DIR = path.join(EXECUTOR_DIR, "data");
const SCOPE_DIR = path.join(EXECUTOR_DIR, "scope");
const BIN_NAME = process.platform === "win32" ? "executor.exe" : "executor";
const BINARY_PATH = path.join(BIN_DIR, BIN_NAME);

const CONNECT_TIMEOUT_MS = 30_000;
const CALL_TIMEOUT_MS = 120_000;
const MAX_RESUME_HOPS = 5;

// Tracks the (url + headers) signature last applied for each executor source,
// so reconcile re-registers a connector whose endpoint/headers changed — not
// just ones that are entirely missing.
const AppliedSourcesSchema = z.record(z.string(), z.string());
type AppliedSources = z.infer<typeof AppliedSourcesSchema>;

/**
 * Install the executor binary from its GitHub release into ~/.inteligir/executor/bin.
 * Best-effort (non-throwing) like the other CLI installers; if it fails the
 * extension simply won't register code-mode tools. Idempotent — skips when the
 * requested version is already installed.
 */
export async function installExecutor(): Promise<void> {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  await installCliFromGithubRelease({
    owner: "RhysSullivan",
    repo: "executor",
    version: EXECUTOR_VERSION,
    binName: BIN_NAME,
    binDir: BIN_DIR,
    // The release archive is flat: the binary plus sidecars
    // (emscripten-module.wasm, keyring.node) that it loads by relative path.
    artifactKind: "archive",
    verify: "version-check",
    artifactName: executorArtifactName,
  });
}

function executorArtifactName(): string | null {
  const os = { darwin: "darwin", linux: "linux", win32: "windows" }[process.platform];
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : null;
  if (!os || !arch) return null;
  const ext = process.platform === "linux" ? "tar.gz" : "zip";
  return `executor-${os}-${arch}.${ext}`;
}

class ExecutorProcess {
  private client: Client | null = null;
  private starting: Promise<Client | null> | null = null;
  // Bumped on every stop() so an in-flight start() that resolves afterwards
  // can detect it was superseded and tear down the now-orphaned client.
  private generation = 0;

  /** Idempotent. Returns the connected client, or null if executor is unavailable. */
  async start(): Promise<Client | null> {
    if (this.client) return this.client;
    if (this.starting) return this.starting;

    const gen = this.generation;
    this.starting = this.spawnAndConnect()
      .then((client) => {
        if (gen !== this.generation) {
          // stop() ran while we were connecting — don't leak the child.
          void client.close().catch(() => {});
          return null;
        }
        this.client = client;
        return client;
      })
      .catch((err) => {
        console.error("[executor] failed to start:", err instanceof Error ? err.message : err);
        return null;
      })
      .finally(() => {
        if (gen === this.generation) this.starting = null;
      });
    return this.starting;
  }

  getClient(): Client | null {
    return this.client;
  }

  async stop(): Promise<void> {
    this.generation++; // invalidate any in-flight start()
    const client = this.client;
    this.client = null;
    this.starting = null;
    await client?.close().catch(() => {});
  }

  private async spawnAndConnect(): Promise<Client> {
    if (!fs.existsSync(BINARY_PATH)) {
      throw new Error(`executor binary not installed at ${BINARY_PATH}`);
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(SCOPE_DIR, { recursive: true });

    const transport = new StdioClientTransport({
      command: BINARY_PATH,
      args: ["mcp", "--scope", SCOPE_DIR, "--elicitation-mode", "model"],
      env: {
        ...(process.env as Record<string, string>),
        EXECUTOR_DATA_DIR: DATA_DIR,
        EXECUTOR_SCOPE_DIR: SCOPE_DIR,
      },
      stderr: "ignore",
    });

    const client = new Client({ name: "inteligir", version: "1.0.0" });
    try {
      await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, "connect to executor");
    } catch (err) {
      // connect() spawns the child before the initialize handshake completes;
      // close it so a timeout/handshake failure doesn't orphan the process.
      await client.close().catch(() => {});
      throw err;
    }
    // Reconcile connectors in the background — addSource does network-bound
    // discovery, so don't block agent startup on it. Sources persist in
    // executor's catalog, so this is a no-op fast path after the first run.
    void this.reconcile(client).catch((err) => console.error("[executor] reconcile failed:", err));
    return client;
  }

  private reconcileQueue: Promise<void> = Promise.resolve();

  /**
   * Bring executor's MCP sources in line with the enabled connectors in
   * mcp.json: (re-)register any that are new or whose endpoint/headers changed,
   * and remove any executor MCP source that's no longer configured. Safe to
   * call on a live client; no-op if executor isn't running.
   *
   * Serialized: fired un-awaited from both startup and the connector IPC
   * handlers, so runs are chained to avoid interleaving add/remove calls on the
   * shared client and clobbering applied-sources.json.
   */
  reconcile(client: Client | null = this.client): Promise<void> {
    const next = this.reconcileQueue.then(() => this.runReconcile(client));
    this.reconcileQueue = next.catch(() => {});
    return next;
  }

  private async runReconcile(client: Client | null): Promise<void> {
    if (!client) return;

    // De-dupe by namespace slug — add() rejects colliding names, but a
    // hand-edited mcp.json could still contain them; keep the first.
    const desired = new Map<string, McpServer>();
    for (const server of getMcpServers().listEnabled()) {
      const ns = mcpServerSlug(server.name);
      if (!desired.has(ns)) desired.set(ns, server);
    }

    let existingMcpIds: Set<string>;
    try {
      existingMcpIds = new Set(
        (await this.listSources(client)).filter((s) => s.kind === "mcp").map((s) => s.id),
      );
    } catch (err) {
      console.error("[executor] reconcile: failed to list sources:", err);
      return;
    }

    const applied = this.appliedStore.read();
    const nextApplied: AppliedSources = {};

    for (const [ns, server] of desired) {
      const sig = connectorSignature(server);
      // Re-register when missing OR when the endpoint/headers changed.
      if (existingMcpIds.has(ns) && applied[ns] === sig) {
        nextApplied[ns] = sig; // unchanged — preserve the recorded signature.
        continue;
      }
      try {
        await this.addSource(client, server, ns);
        nextApplied[ns] = sig; // record only after a successful (re-)register.
      } catch (err) {
        console.error(`[executor] failed to add source "${server.name}":`, err);
      }
    }

    for (const id of existingMcpIds) {
      if (desired.has(id)) continue;
      await this.removeSource(client, id).catch((err) =>
        console.error(`[executor] failed to remove source "${id}":`, err),
      );
    }

    this.appliedStore.write(nextApplied);
  }

  private readonly appliedStore = new JsonStore<AppliedSources>(
    path.join(EXECUTOR_DIR, "applied-sources.json"),
    AppliedSourcesSchema,
    {},
  );

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
    await runCode(client, `return await tools.executor.mcp.addSource(${jsArg(args)});`);
  }

  private async removeSource(client: Client, id: string): Promise<void> {
    // Executor exposes source removal under coreTools; the exact path can vary
    // across versions, so try the known shapes. Surface a warning if none
    // applied rather than failing silently — a lingering source stays reachable.
    const result = await runCode(
      client,
      `const id = ${jsArg(id)};
       const fns = [
         () => tools.executor.coreTools.removeSource({ sourceId: id }),
         () => tools.executor.coreTools.removeSource({ id }),
         () => tools.executor.sources.remove({ sourceId: id }),
       ];
       for (const fn of fns) { try { await fn(); return "__removed__"; } catch (e) {} }
       return "__remove_failed__";`,
    );
    if (result.includes("__remove_failed__")) {
      console.warn(`[executor] could not remove source "${id}" — removal API not recognized`);
    }
  }
}

type ExecutorSource = { id: string; kind: string };

let _instance: ExecutorProcess | null = null;

export function getExecutorProcess(): ExecutorProcess {
  if (!_instance) _instance = new ExecutorProcess();
  return _instance;
}

/**
 * Drop the singleton (and its cached applied-sources state) on logout/teardown,
 * after the process has been stopped, so a re-login doesn't reconcile against
 * stale state pointing at a wiped ~/.inteligir/executor.
 */
export function resetExecutorProcess(): void {
  _instance = null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function connectorSignature(server: McpServer): string {
  return createHash("sha256")
    .update(JSON.stringify({ url: server.url, headers: server.headers ?? {} }))
    .digest("hex");
}

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
  // Executor prints "Execution paused" for elicitation/approval pauses. Match
  // that marker specifically — keying off a bare "executionId" substring would
  // false-trigger a resume on any normal result that happens to contain it.
  return text.includes("Execution paused");
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

/**
 * JSON value for embedding into the executor sandbox's TypeScript source.
 * JSON.stringify escapes quotes/backslashes but leaves U+2028/U+2029 literal —
 * those are valid in JSON but are line terminators in some JS parsers, so
 * escape them to keep generated code well-formed for any connector name/header.
 */
function jsArg(value: unknown): string {
  // U+2028 / U+2029 are valid in JSON strings but are line terminators in some
  // JS parsers; escape them so the generated sandbox code stays well-formed.
  return JSON.stringify(value).replace(/[\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out: ${label} (${ms}ms)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
