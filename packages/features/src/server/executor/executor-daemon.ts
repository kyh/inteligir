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

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { installCliFromGithubRelease } from "@repo/features/server/agent-runtime/install";

import { inteligirPath } from "../lib/json-store";

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
// NOTE: upstream re-uploaded every v1.5.4 asset in place on 2026-06-11
// (~8h after publish; the new zips add libsql.node), which invalidated the
// original pins and broke every fresh install — exactly the fail-closed
// behavior intended. Re-pinned from the re-uploaded assets after verifying
// the darwin-arm64 binary runs and reports v1.5.4.
const EXECUTOR_SHA256: Record<string, string> = {
  "executor-darwin-arm64.zip": "e6b863a65d0ed9a30c36dcce6024d5bec4c3b8949fc51c2458e1ecdd81a8e9e1",
  "executor-darwin-x64.zip": "f58caf3f1f443819405a169e187c53b102d834e618d3880a0391528eaeb3d7f1",
  "executor-linux-arm64.tar.gz": "6a5d5b680f0900a964964d60d35ffca581dbcd76c6f5f0ddd3e26023eb12613d",
  "executor-linux-x64.tar.gz": "9830135f33141313b5b19b4d07a0282f609bcf6a2c8f46982f97137e3ac5d88d",
  "executor-windows-x64.zip": "7ee683a3e95bd7e5a9f75ce8af2726e5ccf43ac509b29d9deb07fc5e32348621",
  "executor-windows-arm64.zip": "3b290e765741f45b73294c35f153d628f6403e63ec00019e058124fdf5fbd4a2",
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

// Executor's server-control manifest: the single-server-per-data-dir lock it
// consults to refuse a second daemon. We read it on startup to detect+reap a
// wedged orphan (see reapWedgedDaemon).
const SERVER_MANIFEST_PATH = path.join(DATA_DIR, "server-control", "server.json");
// Short health probe used only to classify an already-registered daemon as
// healthy (leave it) vs wedged (reap it) — not the generous first-boot window.
const REAP_PROBE_TIMEOUT_MS = 2_000;

// Shape we rely on from the manifest. Everything is treated as untrusted
// (it's on disk and may be from an older executor) and narrowed at the use site.
type ServerManifest = {
  pid?: unknown;
  dataDir?: unknown;
  owner?: { executablePath?: unknown };
  connection?: { origin?: unknown; auth?: { token?: unknown } };
};

function readServerManifest(): ServerManifest | null {
  try {
    // JSON.parse is `any`; the ServerManifest fields are all `unknown` and
    // narrowed at the use site, so this assigns without an assertion.
    const parsed: ServerManifest = JSON.parse(fs.readFileSync(SERVER_MANIFEST_PATH, "utf8"));
    return parsed;
  } catch {
    return null; // absent / unreadable / not JSON → nothing to reap
  }
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = alive but not ours to signal; ESRCH = gone.
    return typeof err === "object" && err !== null && "code" in err && err.code === "EPERM";
  }
}

/**
 * Confirm the live pid is actually OUR executor binary before we SIGKILL it,
 * defeating the (improbable but catastrophic) case where the orphan died and
 * its pid was recycled by an unrelated process. Best-effort: any failure or an
 * inconclusive result returns false so the caller fails safe and does NOT kill.
 */
function pidIsOurExecutor(pid: number): boolean {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
        encoding: "utf8",
      });
      return out.toLowerCase().includes(BIN_NAME.toLowerCase());
    }
    const out = execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" });
    return out.includes(BINARY_PATH);
  } catch {
    return false;
  }
}

/** True if the daemon answers its own API at all (any HTTP status, even 401
 * — that still proves the server is bound and serving). A network error or
 * timeout means it's wedged. */
async function daemonResponds(origin: string, token: string | undefined): Promise<boolean> {
  // Build init without an `undefined` headers key (exactOptionalPropertyTypes).
  const init: RequestInit = { signal: AbortSignal.timeout(REAP_PROBE_TIMEOUT_MS) };
  if (token) init.headers = { authorization: `Bearer ${token}` };
  try {
    await fetch(`${origin.replace(/\/$/, "")}/api/integrations`, init);
    return true;
  } catch {
    return false;
  }
}

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

    // A daemon orphaned by an abnormal Electron exit (crash / force-quit, where
    // graceful stop() never ran) can be left wedged on the data dir; clear it
    // first or both spawn attempts below die with the binary's refuse-to-start.
    await this.reapWedgedDaemon();

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

  /**
   * Reap a wedged orphan daemon left by an abnormal Electron exit. A daemon
   * SIGKILLed indirectly (crash / force-quit, where graceful stop() never ran)
   * can survive: alive, still holding the pinned port and the data-dir
   * server-control manifest, but hung and unresponsive. Executor then refuses
   * to start a replacement against the same data dir, so every launch dies with
   * "exited (code 1) before becoming ready". A wedged daemon also ignores
   * SIGTERM, so stop()'s graceful path can't clear it.
   *
   * Best-effort and heavily guarded — it only ever SIGKILLs a process that is:
   *   1. recorded in OUR manifest (matching data dir + executor binary),
   *   2. still alive, AND still our executor binary at that pid (defeats the
   *      recycled-pid hazard), and
   *   3. not answering its own health endpoint (a responsive daemon is left
   *      untouched — we never kill a working server).
   * A dead daemon's manifest the binary reclaims on its own, so we skip those.
   */
  private async reapWedgedDaemon(): Promise<void> {
    const manifest = readServerManifest();
    const pid = typeof manifest?.pid === "number" ? manifest.pid : null;
    const origin =
      typeof manifest?.connection?.origin === "string" ? manifest.connection.origin : null;
    const token =
      typeof manifest?.connection?.auth?.token === "string"
        ? manifest.connection.auth.token
        : undefined;
    // Only consider a manifest we positively own — never touch a foreign one.
    if (
      pid === null ||
      origin === null ||
      manifest?.dataDir !== DATA_DIR ||
      manifest?.owner?.executablePath !== BINARY_PATH
    ) {
      return;
    }
    if (!pidIsAlive(pid)) return; // dead → executor self-reclaims the manifest
    if (await daemonResponds(origin, token)) return; // healthy → leave it alone
    if (!pidIsOurExecutor(pid)) return; // identity unconfirmed → fail safe

    console.warn(
      `[executor] reaping wedged daemon (pid ${pid}, ${origin}) — holding the data dir but not responding`,
    );
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      return; // already gone
    }
    // Let the OS release the port + manifest lock before we respawn (~2s cap).
    for (let i = 0; i < 20 && pidIsAlive(pid); i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
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
      // Rolling tail of the daemon's own output (stdout+stderr) so a failure
      // reports WHY it died (e.g. "Refusing to start another local server…")
      // instead of a bare exit code. Capped so a long first-boot migration
      // can't grow it unbounded.
      let tail = "";
      const onData = (chunk: Buffer): void => {
        if (settled) return;
        const text = chunk.toString("utf8");
        tail = (tail + text).slice(-1000);
        buffer += text;
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
        settle(() => {
          // Surface the last few non-empty lines the daemon printed — that's
          // where its real complaint lives.
          const reason = tail
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(-3)
            .join(" / ");
          reject(
            new Error(
              `executor daemon exited (code ${code ?? "?"}) before becoming ready` +
                (reason ? `: ${reason}` : ""),
            ),
          );
        }),
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
