// ---------------------------------------------------------------------------
// Agent execute-tool resilience — executeEnsuringDaemon/resumeEnsuringDaemon
// must attempt a daemon (re)start before each call, so a daemon crash
// mid-session doesn't permanently break the agent's execute tool.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Connection = {
  origin: string;
  baseUrl: string;
  token: string;
  redirectUri: string;
};

const daemon = vi.hoisted(() => {
  const state: { connection: Connection | null; startBehavior: "restore" | "fail" } = {
    connection: null,
    startBehavior: "restore",
  };
  const healthyConnection: Connection = {
    origin: "http://127.0.0.1:1",
    baseUrl: "http://127.0.0.1:1/api",
    token: "t",
    redirectUri: "http://127.0.0.1:1/api/oauth/callback",
  };
  return {
    state,
    healthyConnection,
    start: vi.fn(async (): Promise<Connection | null> => {
      if (state.startBehavior === "restore") {
        state.connection = healthyConnection;
        return state.connection;
      }
      return null;
    }),
    getConnection: (): Connection | null => state.connection,
  };
});

vi.mock("../executor/executor-daemon", () => ({
  getExecutorDaemon: () => daemon,
}));

const { executeEnsuringDaemon, resumeEnsuringDaemon } = await import("../executor/executor-client");

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.clearAllMocks();
  daemon.state.connection = null;
  daemon.state.startBehavior = "restore";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({ status: "completed", text: "ran", structured: null, isError: false }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("executeEnsuringDaemon", () => {
  it("restarts a crashed daemon before executing (connection was dropped)", async () => {
    const result = await executeEnsuringDaemon("return 1;");

    expect(daemon.start).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result).toEqual({ status: "completed", text: "ran", structured: null, isError: false });
  });

  it("fails the call cleanly when the daemon cannot be restarted", async () => {
    daemon.state.startBehavior = "fail";

    await expect(executeEnsuringDaemon("return 1;")).rejects.toThrow(
      "executor daemon is not running",
    );
    expect(daemon.start).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("resumeEnsuringDaemon", () => {
  it("restarts a crashed daemon before resuming", async () => {
    const result = await resumeEnsuringDaemon("exec-1", "accept");

    expect(daemon.start).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.text).toBe("ran");
  });
});
