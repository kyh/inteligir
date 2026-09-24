// `thread wait` exit codes ARE the contract a shell script branches on:
// 0 settled idle, 1 settled in error (or not found), 2 timeout, 4 an approval waiting (--until-input).

import type { PendingInteraction } from "@repo/api/local/threads/threads-schema";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  makeFixtureState,
  makeInteraction,
  makeThread,
  serveFixture,
  EMPTY_TIMELINE,
} from "./fixture-server";
import type { FixtureServer, FixtureState, FixtureThread } from "./fixture-server";
import { runCliForTest } from "./run-cli";

const bootWithThread = async (
  statusSequence?: FixtureState["threads"][number]["statusSequence"],
  pendingInteractions: PendingInteraction[] = [],
): Promise<FixtureServer> => {
  const state = makeFixtureState();
  const entry: FixtureThread = {
    pendingInteractions,
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

const approval = makeInteraction({ id: "int_wait", threadId: "thr_wait" });

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

describe("thread wait on a thread blocked by an approval", () => {
  it("names the approval on stderr once, with the verb that answers it, and keeps waiting", async () => {
    const server = await bootWithThread(["active", "active", "active", "idle"], [approval]);
    const result = await runCliForTest({
      argv: ["action", "wait", "thr_wait", "--poll-interval", "20"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("✔ Thread thr_wait is idle.\n");
    expect(result.stderr.match(/int_wait/gu)).toHaveLength(1);
    expect(result.stderr).toContain("inteligir interactions answer <id> <decision>");
  });

  it("stops with exit 4 under --until-input, naming the approval", async () => {
    const server = await bootWithThread(["active"], [approval]);
    const result = await runCliForTest({
      argv: ["action", "wait", "thr_wait", "--until-input", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(4);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "AWAITING_INTERACTION",
      message:
        "Thread thr_wait is waiting on approval int_wait (`inteligir interactions answer <id> <decision>`); answer it, then wait again",
    });
  });

  it("names the approval it was stuck behind when it times out", async () => {
    const server = await bootWithThread(["active"], [approval]);
    const result = await runCliForTest({
      argv: ["action", "wait", "thr_wait", "--timeout", "0.2", "--poll-interval", "20", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stderr)).toEqual({
      error: "WAIT_TIMEOUT",
      message:
        "Thread thr_wait did not settle within 0.2s; it is waiting on approval int_wait (`inteligir interactions answer <id> <decision>`)",
    });
  });

  it("does not stop for an approval already answered", async () => {
    const server = await bootWithThread(
      ["active", "idle"],
      [makeInteraction({ id: "int_done", status: "resolved", threadId: "thr_wait" })],
    );
    const result = await runCliForTest({
      argv: ["action", "wait", "thr_wait", "--until-input", "--poll-interval", "20"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
  });
});
