// Agent memory carried between turns, end to end through the scripted driver
// (issue #575). The scripted driver echoes the exact prompt production code
// assembled (`turnPromptInput`), which is how an e2e sees the per-turn
// injection a real provider would receive.
//
// The proof is two turns on one thread:
//   1. empty memory dir → the assistant echo is EXACTLY the user's text, no
//      leading block. That is the byte-identical-when-empty guarantee.
//   2. after a fact is written to the memory dir (what the agent does with its
//      shell), a following turn's echo carries that fact — the app derived the
//      index fresh off the files, with nothing persisted between turns.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { ApiClient } from "@repo/server-contract/client";
import { expect } from "../harness/assert";
import type { Scenario } from "../harness/scenario";

const FIRST_TURN = "before I remember anything";
const SECOND_TURN = "after I have a memory";
const FACT_NAME = "Prefers tabs";
const FACT_DESCRIPTION = "Indent with tabs, not spaces.";
const TURN_DEADLINE_MS = 30_000;

async function settle(api: ApiClient, threadId: string): Promise<void> {
  const deadline = Date.now() + TURN_DEADLINE_MS;
  for (;;) {
    const detail = await api.threads.get.$get({ query: { threadId } });
    expect(detail.status === 200, `thread get answered ${detail.status}`);
    const { thread } = await detail.json();
    if (thread.status === "idle") {
      return;
    }
    expect(thread.status !== "error", "the turn settled in error");
    expect(Date.now() < deadline, `turn still "${thread.status}" after ${TURN_DEADLINE_MS}ms`);
    await delay(250);
  }
}

async function runTurn(api: ApiClient, threadId: string, text: string): Promise<void> {
  const send = await api.threads.send.$post({
    json: { threadId, text, mode: "steer-if-active" },
  });
  expect(send.status === 200, `send answered ${send.status}`);
  const outcome = await send.json();
  expect(outcome.kind === "started", `send outcome was "${outcome.kind}"`);
  await settle(api, threadId);
}

/** The assistant echo whose text contains the given user text — each turn's
 *  echo ends with its own prompt, so this names the turn unambiguously. */
async function assistantEchoFor(
  api: ApiClient,
  threadId: string,
  userText: string,
): Promise<string> {
  const timeline = await api.threads.timeline.$get({ query: { threadId } });
  expect(timeline.status === 200, `timeline answered ${timeline.status}`);
  const body = await timeline.json();
  expect(body.kind === "full", `timeline answered "${body.kind}"`);
  const echo = body.timeline.rows.find(
    (row) => row.kind === "conversation" && row.role === "assistant" && row.text.includes(userText),
  );
  expect(echo !== undefined, `no assistant echo for "${userText}"`);
  return echo !== undefined && echo.kind === "conversation" ? echo.text : "";
}

export const memoryScripted: Scenario = {
  name: "memory-scripted",
  description:
    "empty memory injects nothing; a fact written between turns is carried into the next",
  async run(ctx) {
    const app = await ctx.boot({ name: "solo", extraEnv: { INTELIGIR_AGENT: "scripted" } });

    const created = await app.api.threads.create.$post({ json: { title: "e2e memory" } });
    expect(created.status === 201, `create answered ${created.status}`);
    const { thread } = await created.json();

    ctx.log("turn 1: empty memory");
    await runTurn(app.api, thread.id, FIRST_TURN);
    const firstEcho = await assistantEchoFor(app.api, thread.id, FIRST_TURN);
    // Byte-identical-when-empty: the echo is exactly the user's text, no block.
    expect(
      firstEcho === `Noted: ${FIRST_TURN}`,
      `empty memory should inject nothing; echo was ${JSON.stringify(firstEcho)}`,
    );

    ctx.log("write a memory fact, the way the agent would with its shell");
    await mkdir(app.memoryDir, { recursive: true });
    await writeFile(
      join(app.memoryDir, "prefers-tabs.md"),
      `---\nname: ${FACT_NAME}\ndescription: ${FACT_DESCRIPTION}\ntype: preference\n---\nStated while reviewing a PR.\n`,
      "utf8",
    );

    ctx.log("turn 2: the fact is carried into the next turn's injection");
    await runTurn(app.api, thread.id, SECOND_TURN);
    const secondEcho = await assistantEchoFor(app.api, thread.id, SECOND_TURN);
    expect(
      secondEcho.includes(FACT_NAME) && secondEcho.includes(FACT_DESCRIPTION),
      `the memory fact was not injected into turn 2; echo was ${JSON.stringify(secondEcho)}`,
    );
    // And the first turn's echo, re-read, still carries nothing — the injection
    // is per turn, not retroactive.
    const firstEchoAgain = await assistantEchoFor(app.api, thread.id, FIRST_TURN);
    expect(
      !firstEchoAgain.includes(FACT_NAME),
      "turn 1's echo must not gain a fact written after it",
    );
  },
};
