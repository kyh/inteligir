import { expect } from "../harness/assert";
import type { Scenario } from "../harness/scenario";
import { untilThreadIdle } from "../harness/threads";

const TURN_TEXT = "Hello from the e2e harness";

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
    await untilThreadIdle(app.api, thread.id);

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
