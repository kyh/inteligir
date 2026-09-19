// `thread wait` exit codes ARE the contract a shell script branches on:
// 0 settled idle, 1 settled in error (or not found), 2 timeout.

import { describe, expect, it, onTestFinished } from "vitest";
import { makeFixtureState, makeThread, serveFixture, EMPTY_TIMELINE } from "./fixture-server";
import type { FixtureServer, FixtureState, FixtureThread } from "./fixture-server";
import { runCliForTest } from "./run-cli";

const bootWithThread = async (
  statusSequence?: FixtureState["threads"][number]["statusSequence"],
): Promise<FixtureServer> => {
  const state = makeFixtureState();
  const entry: FixtureThread = {
    pendingInteractions: [],
    thread: makeThread({ id: "thr_wait", status: "starting" }),
    timeline: EMPTY_TIMELINE,
  };
  if (statusSequence !== undefined) {
    entry.statusSequence = statusSequence;
  }
  state.threads.push(entry);
  const server = await serveFixture(state);
  onTestFinished(async () => {
    await server.close();
  });
  return server;
};

describe("thread wait", () => {
  it("exits 0 once the thread reaches idle", async () => {
    const server = await bootWithThread(["starting", "active", "idle"]);
    const result = await runCliForTest({
      argv: ["action", "wait", "thr_wait", "--poll-interval", "20"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("✔ Thread thr_wait is idle.\n");
  });

  it("answers --json on settle", async () => {
    const server = await bootWithThread(["idle"]);
    const result = await runCliForTest({
      argv: ["action", "wait", "thr_wait", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ status: "idle", threadId: "thr_wait" });
  });

  it("exits 1 when the thread settles in error", async () => {
    const server = await bootWithThread(["active", "error"]);
    const result = await runCliForTest({
      argv: ["action", "wait", "thr_wait", "--poll-interval", "20"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("\n ERROR  Thread thr_wait settled in error\n\n");
  });

  it("exits 2 on timeout while the thread is still running", async () => {
    const server = await bootWithThread(["active"]);
    const result = await runCliForTest({
      argv: ["action", "wait", "thr_wait", "--timeout", "0.2", "--poll-interval", "20"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("did not settle within 0.2s");
  });

  it("exits 1 for a thread that does not exist", async () => {
    const server = await bootWithThread();
    const result = await runCliForTest({
      argv: ["action", "wait", "thr_missing"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("\n ERROR  Not found\n\n");
  });
});
