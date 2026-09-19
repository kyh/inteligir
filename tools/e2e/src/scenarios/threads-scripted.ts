import { setTimeout as delay } from "node:timers/promises";
import { expect } from "../harness/assert";
import type { Scenario } from "../harness/scenario";

const TURN_TEXT = "Hello from the e2e harness";
const TURN_DEADLINE_MS = 30_000;

export const threadsScripted: Scenario = {
  description: "create thread, send a turn through the scripted driver, read the timeline",
  name: "threads-scripted",
  async run(ctx) {
    const app = await ctx.boot({
      extraEnv: { INTELIGIR_AGENT: "scripted" },
      name: "solo",
    });

    ctx.log("create a thread");
    const { thread } = await app.api.threads.create({ title: "e2e scripted turn" });
    expect(thread.id.length > 0, "create answered a thread");

    ctx.log("send a message");
    const outcome = await app.api.threads.send({
      text: TURN_TEXT,
      threadId: thread.id,
    });
    expect(outcome.kind === "started", `send outcome was "${outcome.kind}"`);

    ctx.log("wait for the turn to settle");
    const deadline = Date.now() + TURN_DEADLINE_MS;
    for (;;) {
      const { thread: current } = await app.api.threads.get({ threadId: thread.id });
      if (current.status === "idle") {
        break;
      }
      expect(current.status !== "error", "the turn settled in error");
      expect(Date.now() < deadline, `turn still "${current.status}" after ${TURN_DEADLINE_MS}ms`);
      await delay(250);
    }

    ctx.log("read the timeline");
    const body = await app.api.threads.timeline({ threadId: thread.id });
    expect(body.kind === "full", `timeline without afterSequence answers full, got "${body.kind}"`);
    const { rows } = body.timeline;
    expect(
      rows.some(
        (row) => row.kind === "conversation" && row.role === "user" && row.text === TURN_TEXT,
      ),
      "the user turn is on the timeline",
    );
    expect(
      rows.some((row) => row.kind === "conversation" && row.role === "assistant"),
      "the scripted driver produced an assistant row",
    );
  },
};
