// ---------------------------------------------------------------------------
// Daemon spawn contract — the 1.5.4 invocation (pinned port, foreground,
// stable scope/web-base env), banner parsing with migration log lines ahead
// of the ready banner, and the fallback re-spawn on a busy pinned port.
// Plus installExecutor sequencing: concurrent callers (first-boot eager
// daemon start + executor bundle setup()) must share one in-flight install.
// ---------------------------------------------------------------------------

import { EventEmitter } from "node:events";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const execFileSyncMock = vi.hoisted(() => vi.fn());
// Default: no server-control manifest on disk, so reapWedgedDaemon is a no-op
// in every test that doesn't opt in. (Without this, the daemon reap would read
// the dev's REAL ~/.inteligir manifest during unrelated tests.)
const readFileSyncMock = vi.hoisted(() =>
  vi.fn<() => string>(() => {
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  }),
);

vi.mock("node:child_process", () => ({ spawn: spawnMock, execFileSync: execFileSyncMock }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const overrides = {
    existsSync: () => true,
    mkdirSync: () => undefined,
    readFileSync: readFileSyncMock,
  };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});
vi.mock("@repo/agent-runtime/install", () => ({ installCliFromGithubRelease: vi.fn() }));

const { getExecutorDaemon, installExecutor, resetExecutorDaemon, EXECUTOR_CLI } =
  await import("../executor/executor-daemon");

// The reap guard only acts on a manifest it positively owns (matching binary +
// data dir). Derive both from the exported bin path so the reap test's fixture
// matches whatever ~/.inteligir resolves to on this machine.
const BINARY_PATH = EXECUTOR_CLI.binPath;
const DATA_DIR = path.join(path.dirname(path.dirname(BINARY_PATH)), "data");
const { installCliFromGithubRelease } = await import("@repo/agent-runtime/install");
const installMock = vi.mocked(installCliFromGithubRelease);

class FakeProc extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;
  signalCode: string | null = null;
  kill = vi.fn();
}

type SpawnCall = { args: string[]; env: Record<string, string | undefined> };

const noop = (): void => undefined;

function spawnCall(index: number): SpawnCall {
  const call = spawnMock.mock.calls[index];
  if (!call) throw new Error(`no spawn call at index ${index}`);
  const [, args, opts] = call;
  return { args, env: opts.env };
}

/** A server-control manifest fixture. Defaults match what the reap guard
 * requires to treat the daemon as one we own (our data dir + binary). */
function manifestFor(opts: {
  pid: number;
  token: string;
  origin?: string;
  dataDir?: string;
  executablePath?: string;
}): string {
  const origin = opts.origin ?? "http://localhost:47888";
  return JSON.stringify({
    version: 1,
    kind: "cli-daemon",
    pid: opts.pid,
    dataDir: opts.dataDir ?? DATA_DIR,
    scopeDir: "/scope",
    connection: { kind: "http", origin, auth: { kind: "bearer", token: opts.token } },
    owner: { client: "cli", version: "1.5.4", executablePath: opts.executablePath ?? BINARY_PATH },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.clearAllMocks();
  resetExecutorDaemon();
  // The fallback assertion below checks the spawn env does NOT carry this.
  delete process.env["EXECUTOR_WEB_BASE_URL"];
  // Default to "no manifest" so reapWedgedDaemon is inert; the reap tests
  // override per-case. (vi.clearAllMocks wipes the hoisted impl, so re-arm it.)
  readFileSyncMock.mockImplementation(() => {
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("executor daemon spawn", () => {
  it("spawns on the pinned port and resolves the connection from the banner", async () => {
    const proc = new FakeProc();
    spawnMock.mockImplementation(() => {
      // Migration output precedes the ready banner on first boot after a
      // version bump — the banner scan must skip past it.
      setImmediate(() => {
        proc.stdout.emit(
          "data",
          Buffer.from("[executor] Migrated local Executor data to v2; moved old DB to /x\n"),
        );
        // The real 1.5.4 daemon prints "localhost" in the banner even when
        // spawned with --hostname 127.0.0.1 (verified against the live
        // binary) — the connection must be derived from the banner verbatim.
        proc.stdout.emit(
          "data",
          Buffer.from("Daemon ready on http://localhost:47888\nToken authentication is enabled.\n"),
        );
      });
      return proc;
    });

    const connection = await getExecutorDaemon().start();

    expect(connection).not.toBeNull();
    expect(connection?.origin).toBe("http://localhost:47888");
    expect(connection?.baseUrl).toBe("http://localhost:47888/api");
    expect(connection?.redirectUri).toBe("http://localhost:47888/api/oauth/callback");

    const { args, env } = spawnCall(0);
    expect(args.slice(0, 3)).toEqual(["daemon", "run", "--foreground"]);
    expect(args).toContain("--hostname");
    expect(args).toContain("127.0.0.1");
    const portIdx = args.indexOf("--port");
    expect(portIdx).toBeGreaterThan(-1);
    expect(args[portIdx + 1]).toBe("47888");
    const tokenIdx = args.indexOf("--auth-token");
    expect(tokenIdx).toBeGreaterThan(-1);
    expect(args[tokenIdx + 1]).toBeTruthy();
    expect(args).toContain("--scope");
    // Stable tenant binding + a web base URL matching the pinned port so the
    // daemon's own redirect-URI derivation agrees with ours.
    expect(env["EXECUTOR_DATA_DIR"]).toBeTruthy();
    expect(env["EXECUTOR_SCOPE_DIR"]).toBeTruthy();
    expect(env["EXECUTOR_WEB_BASE_URL"]).toBe("http://127.0.0.1:47888");

    // The readiness probe hit the typed API (at the banner-derived base URL)
    // with the bearer token.
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:47888/api/integrations",
      expect.objectContaining({
        headers: { authorization: `Bearer ${args[tokenIdx + 1]}` },
      }),
    );
  });

  it("falls back to an auto-picked port when the pinned port is taken", async () => {
    const failing = new FakeProc();
    const healthy = new FakeProc();
    spawnMock
      .mockImplementationOnce(() => {
        // Pinned-port attempt: daemon exits before ever printing the banner.
        setImmediate(() => failing.emit("exit", 1));
        return failing;
      })
      .mockImplementationOnce(() => {
        setImmediate(() =>
          healthy.stdout.emit("data", Buffer.from("Daemon ready on http://127.0.0.1:52123\n")),
        );
        return healthy;
      });

    const connection = await getExecutorDaemon().start();

    expect(connection?.origin).toBe("http://127.0.0.1:52123");
    expect(connection?.redirectUri).toBe("http://127.0.0.1:52123/api/oauth/callback");

    const first = spawnCall(0);
    const second = spawnCall(1);
    expect(first.args).toContain("--port");
    expect(second.args).not.toContain("--port");
    // No pinned web base URL on the fallback attempt — it would be wrong.
    expect(second.env["EXECUTOR_WEB_BASE_URL"]).toBeUndefined();
  });
});

describe("executor daemon failure reporting", () => {
  it("surfaces the daemon's own output when it exits before becoming ready", async () => {
    const refusal =
      "A local Executor cli-daemon is registered at http://localhost:47888 (pid 28418) but is not reachable.\n" +
      "Refusing to start another local server against the same data directory.\n";
    const mkFailing = (): FakeProc => {
      const proc = new FakeProc();
      setImmediate(() => {
        proc.stderr.emit("data", Buffer.from(refusal));
        proc.emit("exit", 1);
      });
      return proc;
    };
    // Both the pinned and fallback attempts die the same way.
    spawnMock.mockImplementationOnce(mkFailing).mockImplementationOnce(mkFailing);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const connection = await getExecutorDaemon().start();

    expect(connection).toBeNull();
    const logged = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain(
      "Refusing to start another local server against the same data directory",
    );
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

describe("executor daemon reap", () => {
  it("SIGKILLs a wedged orphan daemon, then respawns", async () => {
    readFileSyncMock.mockReturnValue(
      manifestFor({ pid: 4242, origin: "http://localhost:47888", token: "wedged-token" }),
    );
    // The orphan never answers (wedged); the fresh daemon's probe does.
    // Distinguish them by bearer token, since both sit on the pinned port.
    fetchMock.mockImplementation(async (_url, init) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (auth === "Bearer wedged-token") throw new Error("ECONNREFUSED");
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    // ps confirms the live pid is our executor binary (identity guard).
    execFileSyncMock.mockReturnValue(`${BINARY_PATH} daemon run --foreground\n`);
    let killed = false;
    const killSpy = vi.spyOn(process, "kill").mockImplementation((_pid, signal): true => {
      if (signal === 0) {
        if (killed) throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
        return true;
      }
      if (signal === "SIGKILL") killed = true;
      return true;
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const healthy = new FakeProc();
    spawnMock.mockImplementationOnce(() => {
      setImmediate(() =>
        healthy.stdout.emit("data", Buffer.from("Daemon ready on http://localhost:47888\n")),
      );
      return healthy;
    });

    const connection = await getExecutorDaemon().start();

    expect(connection?.origin).toBe("http://localhost:47888");
    expect(killSpy).toHaveBeenCalledWith(4242, "SIGKILL");
    expect(execFileSyncMock).toHaveBeenCalled();
    killSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("leaves a responsive daemon untouched (never kills a working server)", async () => {
    readFileSyncMock.mockReturnValue(
      manifestFor({ pid: 5151, origin: "http://localhost:47888", token: "healthy-token" }),
    );
    // Default fetchMock answers 200 → the recorded daemon is healthy.
    const killSpy = vi.spyOn(process, "kill").mockImplementation((): true => true);

    const healthy = new FakeProc();
    spawnMock.mockImplementationOnce(() => {
      setImmediate(() =>
        healthy.stdout.emit("data", Buffer.from("Daemon ready on http://localhost:47888\n")),
      );
      return healthy;
    });

    await getExecutorDaemon().start();

    expect(killSpy).not.toHaveBeenCalledWith(5151, "SIGKILL");
    // Health passed → we never reached the identity check or the kill.
    expect(execFileSyncMock).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it("ignores a manifest owned by a different binary", async () => {
    readFileSyncMock.mockReturnValue(
      manifestFor({ pid: 6262, token: "x", executablePath: "/some/other/executor" }),
    );
    const killSpy = vi.spyOn(process, "kill").mockImplementation((): true => true);

    const healthy = new FakeProc();
    spawnMock.mockImplementationOnce(() => {
      setImmediate(() =>
        healthy.stdout.emit("data", Buffer.from("Daemon ready on http://localhost:47888\n")),
      );
      return healthy;
    });

    await getExecutorDaemon().start();

    // Foreign manifest → guard returns before any liveness/health/kill work.
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });
});

describe("installExecutor sequencing", () => {
  it("shares one in-flight install across concurrent callers", async () => {
    let release = noop;
    installMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    // First boot: the eager daemon-start gate (agent-lifecycle) and the
    // executor bundle's setup() call install concurrently — one download,
    // not two racing extracts into the same bin dir.
    const eager = installExecutor();
    const setup = installExecutor();
    expect(installMock).toHaveBeenCalledTimes(1);

    release();
    await Promise.all([eager, setup]);

    // Once settled, a later call runs a fresh (idempotent) pass.
    await installExecutor();
    expect(installMock).toHaveBeenCalledTimes(2);
  });

  it("queues a forced install behind an in-flight one instead of joining it", async () => {
    let release = noop;
    installMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    const plain = installExecutor();
    const forced = installExecutor(true);
    // A repair must not be satisfied by the in-flight plain install's
    // version-check skip…
    expect(installMock).toHaveBeenCalledTimes(1);

    release();
    await Promise.all([plain, forced]);

    // …it runs its own forced pass after the in-flight one settles.
    expect(installMock).toHaveBeenCalledTimes(2);
    expect(installMock.mock.calls[0]?.[0]?.force).toBe(false);
    expect(installMock.mock.calls[1]?.[0]?.force).toBe(true);
  });
});
