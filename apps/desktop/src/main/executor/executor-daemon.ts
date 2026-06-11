// ---------------------------------------------------------------------------
// Executor daemon manager.
//
// Runs `executor daemon run` as a captured child process and exposes its local
// HTTP API (https://executor.sh). Executor is the integration layer / backend:
// it owns the catalog of integrations (MCP / OpenAPI / GraphQL incl. Google
// discovery bundles), connections (credentials, incl. OAuth), tool execution
// (code mode), and policies. Inteligir wraps that API behind IPC and renders
// its own UI on top — it does not use executor's bundled web UI.
//
// Lifecycle: the binary is installed from executor's GitHub release into
// ~/.inteligir/executor/bin during the extension's setup(). start() spawns the
// daemon bound to 127.0.0.1 on a pinned port (so the OAuth redirect URI the
// user whitelists in e.g. Google Cloud stays stable across restarts), with a
// random bearer token, and confirms readiness by parsing the "Daemon ready on
// http://host:port" banner from stdout. If the pinned port is taken, it
// retries on an auto-picked port — everything keeps working except externally
// whitelisted OAuth redirect URIs. Catalog state + OAuth tokens persist under
// ~/.inteligir/executor (fixed data + scope dir) across restarts.
//
// First boot after a version bump may run executor's one-way data migration
// (v1 sqlite → v2); migration log lines precede the ready banner.
// ---------------------------------------------------------------------------

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { installCliFromGithubRelease } from "@repo/agent-runtime/install";

import { inteligirPath } from "@/main/lib/json-store";

const EXECUTOR_VERSION = "1.5.4";
const EXECUTOR_DIR = inteligirPath("executor");
const BIN_DIR = path.join(EXECUTOR_DIR, "bin");
const DATA_DIR = path.join(EXECUTOR_DIR, "data");
const SCOPE_DIR = path.join(EXECUTOR_DIR, "scope");
const BIN_NAME = process.platform === "win32" ? "executor.exe" : "executor";
const BINARY_PATH = path.join(BIN_DIR, BIN_NAME);

// SHA-256 of every release artifact we install, pinned at the time of the
// EXECUTOR_VERSION bump above. Verified at install time — a tampered or
// re-uploaded release fails closed instead of running unverified code. When
// bumping the version, recompute by downloading each platform's asset and
// running `shasum -a 256 <file>`.
// (The release also ships linux musl tarballs; executorArtifactName can't
// select those — no musl detection — so they're deliberately unpinned.)
const EXECUTOR_SHA256: Record<string, string> = {
  "executor-darwin-arm64.zip": "4057ab48134340e1827aac9ecf32a8496d3d7d5f17d5711af247c1fbe9a83daa",
  "executor-darwin-x64.zip": "e5f06ce710b78db2232a7d17a70a18df3aa91ba34285374c707fdc3bdba6b79e",
  "executor-linux-arm64.tar.gz": "22ef7e9ecd479b2b7b5af41ee229213de7a0f5f7028f1ffecb7ec0e9e7bdecc4",
  "executor-linux-x64.tar.gz": "0de0c34fc1b4b4e663504df9dea1d096df40741727c5152ad6ac04eafcf06451",
  "executor-windows-x64.zip": "cd7ebeaf273968234af7c9e08ba96fb6a2159dd233700c1463b35502fa212ef8",
  "executor-windows-arm64.zip": "eca9be1130732c4d3434bd1955212d1aac2ff74fa3f391197e59a8b1698df2b6",
};

// Generous on purpose: the first boot after a version bump replays executor's
// one-way v1→v2 data migration before the HTTP server binds, and parts of it
// are network-dependent (OAuth metadata fetches). A tight timeout here could
// kill the daemon mid-migration and loop it on every launch.
const READY_TIMEOUT_MS = 120_000;
const STOP_GRACE_MS = 5_000;
// Pinned daemon port. The OAuth redirect URI (`<origin>/api/oauth/callback`)
// must be whitelisted verbatim in the user's Google Cloud OAuth app, so it has
// to survive restarts. Deliberately NOT executor's default 4788, to avoid
// colliding with a standalone executor install.
const PINNED_PORT = 47888;
// Banner the daemon prints once the HTTP server is bound. The 1.5.4 binary
// prints "localhost" even when spawned with --hostname 127.0.0.1, e.g.
//   "Daemon ready on http://localhost:47888"
// — so the connection (origin/baseUrl/redirectUri) is derived from the banner
// verbatim and everything downstream (OAuth redirect URI shown to the user,
// redirectUri passed on oauth start) stays consistent with it.
const READY_RE = /Daemon ready on (https?:\/\/[^\s]+)/i;

type ExecutorConnection = {
  /** Daemon origin, e.g. http://localhost:47888 */
  origin: string;
  /** Full API base, e.g. http://localhost:47888/api */
  baseUrl: string;
  /** Bearer token required on every request (OAuth callback/await excepted). */
  token: string;
  /** Browser-facing OAuth redirect URI served by the daemon (auth-exempt). */
  redirectUri: string;
};

// In-flight install shared across concurrent callers (see installExecutor).
let installInFlight: Promise<void> | null = null;

/**
 * Install the executor binary from its GitHub release into
 * ~/.inteligir/executor/bin. Best-effort (non-throwing) like the other CLI
 * installers; idempotent — skips when the requested version is already there.
 *
 * Concurrent callers share one in-flight install: on first boot the eager
 * daemon start in agent-lifecycle gates on this while the executor bundle's
 * setup() runs it too, and two racing downloads into the same bin dir would
 * corrupt each other. A forced install (repair) queues behind any in-flight
 * pass instead of joining it, so it can't be satisfied by a plain
 * version-check skip.
 */
export function installExecutor(force = false): Promise<void> {
  if (installInFlight && !force) return installInFlight;
  const queued = installInFlight
    ? installInFlight.catch(() => undefined).then(() => runExecutorInstall(force))
    : runExecutorInstall(force);
  const next: Promise<void> = queued.finally(() => {
    if (installInFlight === next) installInFlight = null;
  });
  installInFlight = next;
  return next;
}

async function runExecutorInstall(force: boolean): Promise<void> {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  await installCliFromGithubRelease({
    owner: "RhysSullivan",
    repo: "executor",
    version: EXECUTOR_VERSION,
    binName: BIN_NAME,
    binDir: BIN_DIR,
    // Flat archive: binary + sidecars (emscripten-module.wasm, keyring.node).
    artifactKind: "archive",
    verify: "inline-sha256",
    sha256: EXECUTOR_SHA256,
    artifactName: executorArtifactName,
    force,
  });
}

/** CLI metadata for the integrations UI (installed-vs-pinned + repair). */
export const EXECUTOR_CLI = { name: "executor", version: EXECUTOR_VERSION, binPath: BINARY_PATH };

function executorArtifactName(): string | null {
  const platformNames: Partial<Record<NodeJS.Platform, string>> = {
    darwin: "darwin",
    linux: "linux",
    win32: "windows",
  };
  const os = platformNames[process.platform];
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
        console.error(
          "[executor] daemon failed to start:",
          err instanceof Error ? err.message : err,
        );
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

    try {
      return await this.spawnAttempt({ pinnedPort: true });
    } catch (err) {
      // Most likely the pinned port is taken (another app, or a wedged old
      // daemon). Fall back to an auto-picked port so code mode and the
      // connectors keep working; only externally whitelisted OAuth redirect
      // URIs (Google) break until the pinned port frees up.
      console.warn(
        `[executor] daemon start on pinned port ${PINNED_PORT} failed, retrying on a free port:`,
        err instanceof Error ? err.message : err,
      );
      return this.spawnAttempt({ pinnedPort: false });
    }
  }

  private async spawnAttempt(opts: {
    pinnedPort: boolean;
  }): Promise<{ proc: ChildProcess; connection: ExecutorConnection }> {
    const token = randomUUID();
    const pinnedOrigin = `http://127.0.0.1:${PINNED_PORT}`;
    const proc = spawn(
      BINARY_PATH,
      [
        "daemon",
        "run",
        "--foreground",
        "--hostname",
        "127.0.0.1",
        ...(opts.pinnedPort ? ["--port", String(PINNED_PORT)] : []),
        "--auth-token",
        token,
        "--scope",
        SCOPE_DIR,
      ],
      {
        env: {
          ...process.env,
          EXECUTOR_DATA_DIR: DATA_DIR,
          // Tenant id is derived from EXECUTOR_SCOPE_DIR (else cwd) — pin it so
          // the daemon's data stays visible regardless of Electron's cwd.
          EXECUTOR_SCOPE_DIR: SCOPE_DIR,
          // The daemon derives its own OAuth redirect URI from this (its
          // internal default uses $PORT, not the actual bound port). Only
          // correct on the pinned-port attempt; the client also passes
          // redirectUri explicitly on every oauth start as a belt-and-braces.
          ...(opts.pinnedPort ? { EXECUTOR_WEB_BASE_URL: pinnedOrigin } : {}),
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

    const normalized = origin.replace(/\/$/, "");
    const baseUrl = `${normalized}/api`;
    // Probe the typed API with the token so a half-up daemon (or an auth
    // mismatch) fails here instead of on the first real call.
    await this.probeApi(baseUrl, token).catch((err: unknown) => {
      this.killProc(proc);
      throw err;
    });

    return {
      proc,
      connection: {
        origin: normalized,
        baseUrl,
        token,
        redirectUri: `${normalized}/api/oauth/callback`,
      },
    };
  }

  /** Resolve the daemon's origin by parsing its readiness banner from stdout.
   * Migration/warning lines may precede the banner; they're scanned past. */
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
        const origin = match?.[1];
        if (origin) settle(() => resolve(origin));
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

  private async probeApi(baseUrl: string, token: string): Promise<void> {
    const resp = await fetch(`${baseUrl}/integrations`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) throw new Error(`GET /integrations failed: ${resp.status}`);
    const body: unknown = await resp.json();
    if (!Array.isArray(body)) {
      throw new Error("GET /integrations returned a non-array response");
    }
  }
}

let instance: ExecutorDaemon | null = null;

export function getExecutorDaemon(): ExecutorDaemon {
  if (!instance) instance = new ExecutorDaemon();
  return instance;
}

/** Drop the singleton on logout/teardown, after stop(), so a re-login starts clean. */
export function resetExecutorDaemon(): void {
  instance = null;
}
