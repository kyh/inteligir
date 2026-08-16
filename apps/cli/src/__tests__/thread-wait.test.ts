// `thread wait` exit codes ARE the contract a shell script branches on:
// 0 settled idle, 1 settled in error (or not found), 2 timeout.

import { afterEach, describe, expect, it } from "vitest";
import {
  makeFixtureState,
  makeThread,
  serveFixture,
  EMPTY_TIMELINE,
  type FixtureServer,
  type FixtureState,
} from "./fixture-server";
import { runCliForTest } from "./run-cli";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup();
  }
});

async function bootWithThread(
  statusSequence: FixtureState["threads"][number]["statusSequence"],
): Promise<FixtureServer> {
  const state = makeFixtureState();
  state.threads.push({
    thread: makeThread({ id: "thr_wait", status: "starting" }),
    pendingInteractions: [],
    timeline: EMPTY_TIMELINE,
    ...(statusSequence === undefined ? {} : { statusSequence }),
  });
  const server = await serveFixture(state);
  cleanups.push(() => server.close());
  return server;
}

describe("thread wait", () => {
  it("exits 0 once the thread reaches idle", async () => {
    const server = await bootWithThread(["starting", "active", "idle"]);
    const result = await runCliForTest({
      argv: ["thread", "wait", "thr_wait", "--poll-interval", "20"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("Thread thr_wait is idle.\n");
  });

  it("answers --json on settle", async () => {
    const server = await bootWithThread(["idle"]);
    const result = await runCliForTest({
      argv: ["thread", "wait", "thr_wait", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ threadId: "thr_wait", status: "idle" });
  });

  it("exits 1 when the thread settles in error", async () => {
    const server = await bootWithThread(["active", "error"]);
    const result = await runCliForTest({
      argv: ["thread", "wait", "thr_wait", "--poll-interval", "20"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("Error: Thread thr_wait settled in error\n");
  });

  it("exits 2 on timeout while the thread is still running", async () => {
    const server = await bootWithThread(["active"]);
    const result = await runCliForTest({
      argv: ["thread", "wait", "thr_wait", "--timeout", "0.2", "--poll-interval", "20"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('still "active" after 0.2s');
  });

  it("exits 1 for a thread that does not exist", async () => {
    const server = await bootWithThread(undefined);
    const result = await runCliForTest({
      argv: ["thread", "wait", "thr_missing"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("(not_found)");
  });
});
