// ---------------------------------------------------------------------------
// Executor daemon manager.
//
// Runs `executor daemon run` as a captured child process and exposes its local
// HTTP API (https://executor.sh). Executor is the integration layer / backend:
// it owns the catalog of sources (MCP / OpenAPI / GraphQL / Google), secrets,
// OAuth connections, tool execution (code mode), and policies. Inteligir wraps
// that API behind IPC and renders its own UI on top — it does not use
// executor's bundled web UI.
//
// Lifecycle: the binary is installed from executor's GitHub release into
// ~/.inteligir/executor/bin during the extension's setup(). start() spawns the
// daemon bound to 127.0.0.1 with a random bearer token, lets it auto-pick a
// port, and discovers the actual port by parsing the "Daemon ready on
// http://host:port" banner from stdout. Catalog state + OAuth tokens persist
// under ~/.inteligir/executor (fixed data + scope dir) across restarts.
// ---------------------------------------------------------------------------

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { installCliFromGithubRelease } from "@repo/agent-runtime/install";

import { inteligirPath } from "@/main/lib/json-store";

const EXECUTOR_VERSION = "1.4.33";
const EXECUTOR_DIR = inteligirPath("executor");
const BIN_DIR = path.join(EXECUTOR_DIR, "bin");
const DATA_DIR = path.join(EXECUTOR_DIR, "data");
const SCOPE_DIR = path.join(EXECUTOR_DIR, "scope");
const BIN_NAME = process.platform === "win32" ? "executor.exe" : "executor";
const BINARY_PATH = path.join(BIN_DIR, BIN_NAME);

const READY_TIMEOUT_MS = 30_000;
const STOP_GRACE_MS = 5_000;
// Banner the daemon prints once the HTTP server is bound, e.g.
//   "Daemon ready on http://127.0.0.1:51734"
const READY_RE = /Daemon ready on (https?:\/\/[^\s]+)/i;

export type ExecutorConnection = {
  /** Full API base, e.g. http://127.0.0.1:51734/api */
  baseUrl: string;
  /** Bearer token required on every request (OAuth callback/await excepted). */
  token: string;
  /** Active scope id (e.g. "scope:/Users/x/.inteligir/executor/scope"). */
  scopeId: string;
  /** Active scope info, captured at start (immutable for the daemon's life). */
  scope: { id: string; name: string; dir: string };
};

/**
 * Install the executor binary from its GitHub release into
 * ~/.inteligir/executor/bin. Best-effort (non-throwing) like the other CLI
 * installers; idempotent — skips when the requested version is already there.
 */
export async function installExecutor(force = false): Promise<void> {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  await installCliFromGithubRelease({
    owner: "RhysSullivan",
    repo: "executor",
    version: EXECUTOR_VERSION,
    binName: BIN_NAME,
    binDir: BIN_DIR,
    // Flat archive: binary + sidecars (emscripten-module.wasm, keyring.node).
    artifactKind: "archive",
    verify: "version-check",
    artifactName: executorArtifactName,
    force,
  });
}

/** CLI metadata for the integrations UI (installed-vs-pinned + repair). */
export const EXECUTOR_CLI = { name: "executor", version: EXECUTOR_VERSION, binPath: BINARY_PATH };

function executorArtifactName(): string | null {
  const os = { darwin: "darwin", linux: "linux", win32: "windows" }[process.platform];
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : null;
  if (!os || !arch) return null;
  const ext = process.platform === "linux" ? "tar.gz" : "zip";
  return `executor-${os}-${arch}.${ext}`;
}

class ExecutorDaemon {
  private proc: ChildProcess | null = null;
  private connection: ExecutorConnection | null = null;
  private starting: Promise<ExecutorConnection | null> | null = null;
  // Bumped on stop() so an in-flight start() that resolves afterwards can tell
  // it was superseded and tear down the orphaned child.
  private generation = 0;

  /** Idempotent. Returns the live connection, or null if the daemon is unavailable. */
  async start(): Promise<ExecutorConnection | null> {
    if (this.connection) return this.connection;
    if (this.starting) return this.starting;

    const gen = this.generation;
    this.starting = this.spawnDaemon()
      .then((result) => {
        if (gen !== this.generation) {
          this.killProc(result.proc);
          return null;
        }
        this.proc = result.proc;
        this.connection = result.connection;
        // If the daemon dies unexpectedly, drop the connection so callers see
        // it as down and the next start() re-spawns instead of short-circuiting
        // on a stale connection pointing at a dead port.
        result.proc.once("exit", () => {
          if (this.proc === result.proc) {
            this.proc = null;
            this.connection = null;
          }
        });
        return result.connection;
      })
      .catch((err) => {
        console.error("[executor] daemon failed to start:", err instanceof Error ? err.message : err);
        return null;
      })
      .finally(() => {
        if (gen === this.generation) this.starting = null;
      });
    return this.starting;
  }

  getConnection(): ExecutorConnection | null {
    return this.connection;
  }

  async stop(): Promise<void> {
    this.generation++;
    const proc = this.proc;
    this.proc = null;
    this.connection = null;
    this.starting = null;
    this.killProc(proc);
  }

  private killProc(proc: ChildProcess | null): void {
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
    let exited = false;
    proc.once("exit", () => {
      exited = true;
    });
    proc.kill("SIGTERM");
    setTimeout(() => {
      // proc.killed only reflects that a signal was delivered, not that the
      // process exited — so gate the SIGKILL escalation on actual exit.
      if (!exited) {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }, STOP_GRACE_MS).unref();
  }

  private async spawnDaemon(): Promise<{ proc: ChildProcess; connection: ExecutorConnection }> {
    if (!fs.existsSync(BINARY_PATH)) {
      throw new Error(`executor binary not installed at ${BINARY_PATH}`);
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(SCOPE_DIR, { recursive: true });

    const token = randomUUID();
    const proc = spawn(
      BINARY_PATH,
      [
        "daemon",
        "run",
        "--foreground",
        "--hostname",
        "127.0.0.1",
        "--auth-token",
        token,
        "--scope",
        SCOPE_DIR,
      ],
      {
        env: {
          ...(process.env as Record<string, string>),
          EXECUTOR_DATA_DIR: DATA_DIR,
          EXECUTOR_SCOPE_DIR: SCOPE_DIR,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let origin: string;
    try {
      origin = await this.awaitReady(proc);
    } catch (err) {
      this.killProc(proc);
      throw err;
    }

    const baseUrl = `${origin.replace(/\/$/, "")}/api`;
    const scope = await this.fetchScope(baseUrl, token).catch((err) => {
      this.killProc(proc);
      throw err;
    });

    return { proc, connection: { baseUrl, token, scopeId: scope.id, scope } };
  }

  /** Resolve the daemon's origin by parsing its readiness banner from stdout. */
  private awaitReady(proc: ChildProcess): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      let buffer = "";
      const onData = (chunk: Buffer): void => {
        if (settled) return;
        buffer += chunk.toString("utf8");
        // Only match on complete lines — a streamed chunk can split the URL
        // mid-token, and a greedy match would capture a truncated origin.
        const newlineIdx = buffer.lastIndexOf("\n");
        if (newlineIdx < 0) return;
        const complete = buffer.slice(0, newlineIdx);
        const match = complete.match(READY_RE);
        if (match) settle(() => resolve(match[1]!));
      };
      const finish = (): void => {
        proc.stdout?.off("data", onData);
        proc.stderr?.off("data", onData);
      };
      const settle = (action: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        finish();
        action();
      };
      const timer = setTimeout(
        () =>
          settle(() =>
            reject(new Error(`executor daemon did not become ready within ${READY_TIMEOUT_MS}ms`)),
          ),
        READY_TIMEOUT_MS,
      );

      proc.stdout?.on("data", onData);
      proc.stderr?.on("data", onData);
      proc.on("exit", (code) =>
        settle(() =>
          reject(new Error(`executor daemon exited (code ${code ?? "?"}) before becoming ready`)),
        ),
      );
      proc.on("error", (err) => settle(() => reject(err)));
    });
  }

  private async fetchScope(
    baseUrl: string,
    token: string,
  ): Promise<{ id: string; name: string; dir: string }> {
    const resp = await fetch(`${baseUrl}/scope`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) throw new Error(`GET /scope failed: ${resp.status}`);
    const body = (await resp.json()) as { id?: unknown; name?: unknown; dir?: unknown };
    if (typeof body.id !== "string") throw new Error("GET /scope returned no scope id");
    return {
      id: body.id,
      name: typeof body.name === "string" ? body.name : body.id,
      dir: typeof body.dir === "string" ? body.dir : "",
    };
  }
}

let _instance: ExecutorDaemon | null = null;

export function getExecutorDaemon(): ExecutorDaemon {
  if (!_instance) _instance = new ExecutorDaemon();
  return _instance;
}

/** Drop the singleton on logout/teardown, after stop(), so a re-login starts clean. */
export function resetExecutorDaemon(): void {
  _instance = null;
}
