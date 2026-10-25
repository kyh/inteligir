// `thread wait` exit codes ARE the contract a shell script branches on:
// 0 settled idle, 1 settled in error (or not found), 2 timeout.
// Against the real composition: the provider is the booted suites' manual one, so a turn runs
// until a case ends it, and every status the verb reads is the server's own.

import { setTimeout as delay } from "node:timers/promises";
import { createPendingInteraction } from "@repo/db/pending-interactions";
import type { ApprovalPendingInteractionPayload } from "@repo/domain/pending-interactions";
import { describe, expect, it } from "vitest";
import { createThread, sendMessage } from "./server/agents/test-support/agent-test-harness";
import { bootThreadHarness, shareBoot } from "./server/test-support/boot-app";
import { cliOver } from "./test-support/booted-cli";

const APPROVAL: ApprovalPendingInteractionPayload = {
  availableDecisions: ["allow_once", "deny"],
  kind: "approval",
  reason: null,
  subject: { command: "npm install", cwd: null, itemId: "cmd_1", kind: "command" },
};

// long enough that a wait polling every 20 ms reads the running turn several times first
const WHILE_IT_POLLS_MS = 150;

// one server for the file, and an action of its own for each case
const shared = shareBoot(
  async (teardown) => await cliOver(await bootThreadHarness({ mode: "manual" }, { teardown })),
);

const bootWaiting = async () => {
  const over = shared();
  const { app } = over;
  const threadId = await createThread(app.client);
  // a turn the provider holds open until the case ends it
  const run = async (): Promise<string> => await sendMessage(app.client, threadId, "go");
  const approval = (turnId: string): string =>
    createPendingInteraction(app.db, app.bus, {
      payload: APPROVAL,
      requestKey: `req_${turnId}`,
      threadId,
      turnId,
    }).id;
  // the wait, with the turn ended `afterMs` into it
  const waitEnding = async (argv: string[], end: () => void, afterMs = WHILE_IT_POLLS_MS) => {
    const [result] = await Promise.all([
      over.cli(["action", "wait", threadId, ...argv]),
      (async () => {
        await delay(afterMs);
        end();
      })(),
    ]);
    return result;
  };
  return { app, approval, cli: over.cli, run, threadId, waitEnding };
};

describe("thread wait", { timeout: 60_000 }, () => {
  it("exits 0 once the running thread reaches idle", async () => {
    const { app, run, threadId, waitEnding } = await bootWaiting();
    const turnId = await run();
    const running = await app.client.threads.get({ threadId });
    expect(running.thread.status).toBe("active");
    const result = await waitEnding(["--poll-interval", "20"], () => {
      app.driver.completeTurn(threadId, turnId, "completed");
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`✔ Thread ${threadId} is idle.\n`);
  });

  it("answers --json on settle", async () => {
    const { cli, threadId } = await bootWaiting();
    const result = await cli(["action", "wait", threadId, "--json"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ status: "idle", threadId });
  });

  it("exits 1 when the thread settles in error", async () => {
    const { app, run, threadId, waitEnding } = await bootWaiting();
    const turnId = await run();
    const result = await waitEnding(["--poll-interval", "20"], () => {
      app.driver.failTurn(threadId, turnId, "other");
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(`\n ERROR  Thread ${threadId} settled in error\n\n`);
  });

  it("exits 2 on timeout while the thread is still running", async () => {
    const { cli, run, threadId } = await bootWaiting();
    await run();
    const result = await cli([
      "action",
      "wait",
      threadId,
      "--timeout",
      "0.2",
      "--poll-interval",
      "20",
    ]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("did not settle within 0.2s");
  });

  it("exits 1 for a thread that does not exist", async () => {
    const { cli } = await bootWaiting();
    const result = await cli(["action", "wait", "thr_missing"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("\n ERROR  Thread not found\n\n");
  });
});

describe("thread wait on a thread blocked by an approval", { timeout: 60_000 }, () => {
  it("names the approval on stderr once, as the person's to answer in the app, and keeps waiting", async () => {
    const { app, approval, run, threadId, waitEnding } = await bootWaiting();
    const turnId = await run();
    const waiting = approval(turnId);
    const result = await waitEnding(["--poll-interval", "20"], () => {
      app.driver.completeTurn(threadId, turnId, "completed");
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`✔ Thread ${threadId} is idle.\n`);
    expect(result.stderr.split(waiting)).toHaveLength(2);
    expect(result.stderr).toContain(
      `waiting on approval ${waiting}, which the person answers in the app; still waiting`,
    );
  });

  it("names the approval it was stuck behind when it times out", async () => {
    const { approval, cli, run, threadId } = await bootWaiting();
    const waiting = approval(await run());
    const result = await cli([
      "action",
      "wait",
      threadId,
      "--timeout",
      "0.2",
      "--poll-interval",
      "20",
      "--json",
    ]);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stderr)).toEqual({
      error: "WAIT_TIMEOUT",
      message: `Thread ${threadId} did not settle within 0.2s; it is waiting on approval ${waiting}, which the person answers in the app`,
    });
  });

  it("names no approval already answered", async () => {
    const { app, approval, run, threadId, waitEnding } = await bootWaiting();
    const turnId = await run();
    await app.client.threads.answerInteraction({
      decision: "allow_once",
      interactionId: approval(turnId),
      threadId,
    });
    const result = await waitEnding(["--poll-interval", "20"], () => {
      app.driver.completeTurn(threadId, turnId, "completed");
    });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
  });
});
