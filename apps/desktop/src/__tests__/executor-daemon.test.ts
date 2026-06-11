// ---------------------------------------------------------------------------
// Daemon spawn contract — the 1.5.4 invocation (pinned port, foreground,
// stable scope/web-base env), banner parsing with migration log lines ahead
// of the ready banner, and the fallback re-spawn on a busy pinned port.
// Plus installExecutor sequencing: concurrent callers (first-boot eager
// daemon start + executor bundle setup()) must share one in-flight install.
// ---------------------------------------------------------------------------

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: () => true,
      mkdirSync: () => undefined,
    },
  };
});
vi.mock("@repo/agent-runtime/install", () => ({ installCliFromGithubRelease: vi.fn() }));

const { getExecutorDaemon, installExecutor, resetExecutorDaemon } =
  await import("@/main/executor/executor-daemon");
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

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.clearAllMocks();
  resetExecutorDaemon();
  // The fallback assertion below checks the spawn env does NOT carry this.
  delete process.env["EXECUTOR_WEB_BASE_URL"];
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
