// A chat turn end to end through the scripted agent driver. The env contract
// (INTELIGIR_AGENT=scripted) is being built in parallel with this harness:
// apps/app/src/node/main.ts still hardwires `unavailableTurnDriver`, so a
// send answers 503 and this scenario reports SKIP with the wiring gap named.
// Everything below the probe is real and runs the moment the contract lands.

import { setTimeout as delay } from "node:timers/promises";
import { expect, skip } from "../harness/assert";
import type { Scenario } from "../harness/scenario";

const TURN_TEXT = "Hello from the e2e harness";
const TURN_DEADLINE_MS = 30_000;

export const threadsScripted: Scenario = {
  name: "threads-scripted",
  description: "create thread, send a turn through the scripted driver, read the timeline",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      extraEnv: { INTELIGIR_AGENT: "scripted" },
    });

    ctx.log("create a thread");
    const created = await app.api.threads.create.$post({ json: { title: "e2e scripted turn" } });
    expect(created.status === 201, `create answered ${created.status}`);
    const { thread } = await created.json();

    ctx.log("send a message");
    const send = await app.api.threads.send.$post({
      json: { threadId: thread.id, text: TURN_TEXT, mode: "steer-if-active" },
    });
    if (send.status === 503) {
      skip(
        "the scripted agent driver is not wired into the app process yet: " +
          "INTELIGIR_AGENT=scripted has no reader in apps/app/src/node/main.ts " +
          "(createTurnDriver is hardwired to unavailableTurnDriver, so /threads/send answers 503). " +
          "The scenario below this probe is complete — it runs unchanged once #549 lands the env contract.",
      );
    }
    expect(send.status === 200, `send answered ${send.status}`);
    const outcome = await send.json();
    expect(outcome.kind === "started", `send outcome was "${outcome.kind}"`);

    ctx.log("wait for the turn to settle");
    const deadline = Date.now() + TURN_DEADLINE_MS;
    for (;;) {
      const detail = await app.api.threads.get.$get({ query: { threadId: thread.id } });
      expect(detail.status === 200, `thread get answered ${detail.status}`);
      const { thread: current } = await detail.json();
      if (current.status === "idle") {
        break;
      }
      expect(current.status !== "error", "the turn settled in error");
      expect(Date.now() < deadline, `turn still "${current.status}" after ${TURN_DEADLINE_MS}ms`);
      await delay(250);
    }

    ctx.log("read the timeline");
    const timeline = await app.api.threads.timeline.$get({ query: { threadId: thread.id } });
    expect(timeline.status === 200, `timeline answered ${timeline.status}`);
    const body = await timeline.json();
    expect(body.kind === "full", `timeline without afterSequence answers full, got "${body.kind}"`);
    const rows = body.timeline.rows;
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
