import { randomUUID } from "node:crypto";

import { agentEventSchema } from "@repo/contract/library/agent-events";
import { agentTurn, agentUsage } from "@repo/db/agent-schema";
import { db } from "@repo/db/drizzle-client";
import { dbSuite } from "@repo/db/test-database";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createFakeAgentPlatform,
  fakeAgentRuntime,
} from "../test-support/fake-agent-platform.test-utils";
import type { FakeAgentPlatform } from "../test-support/fake-agent-platform.test-utils";
import { makeAccount, personalLibrary } from "../test-support/library.fixture";
import { caughtUp, readStream, shownOf } from "../test-support/thread-reads.test-utils";
import { costMicroUsdOf } from "./agent-model";
import { deleteAgentThread, sendToAgent } from "./agent-sessions";
import { threadOf } from "./agent-threads";
import type { AgentRuntime } from "./runtime";

const OWN_KEY = `sk-ant-api03-${"k".repeat(40)}`;

const CREATE_NOTE = 'call create_note {"markdown":"Water the garden.","title":"Garden"}';

let platform: FakeAgentPlatform;
let runtime: AgentRuntime;
let settled: () => Promise<void>;

beforeEach(() => {
  platform = createFakeAgentPlatform();
  ({ runtime, settled } = fakeAgentRuntime(platform));
});

type Library = Awaited<ReturnType<typeof personalLibrary>>["library"];

const shownIn = async (library: Library, threadId: string) =>
  shownOf(await readStream(await library.agent.events({ threadId }), caughtUp));

const turnIn = async (accountId: string, text: string) => {
  const { threadId } = await sendToAgent(runtime, accountId, { opId: randomUUID(), text });
  await platform.turnsSettled();

  return threadId;
};

const refusalOf = async (sent: Promise<unknown>) => {
  try {
    await sent;
  } catch (error) {
    return error;
  }

  throw new Error("the send was let in");
};

describe("a model call's price", () => {
  it("prices fresh input, cache writes, cache reads and output each at their own rate", () => {
    expect(
      costMicroUsdOf({
        cacheReadTokens: 600,
        cacheWriteTokens: 100,
        inputTokens: 1000,
        outputTokens: 50,
      }),
    ).toBe(300 * 2 + 100 * 2.5 + 600 * 0.1 + 50 * 10);
  });
});

dbSuite("the built-in agent's limits", () => {
  it("answers the allowance to a third send in a day, and its resend as it answered", async () => {
    const { accountId, library } = await personalLibrary();
    await turnIn(accountId, "Hello");
    const opId = randomUUID();
    const second = await sendToAgent(runtime, accountId, { opId, text: "Again" });
    await platform.turnsSettled();

    expect(await refusalOf(sendToAgent(runtime, accountId, { text: "Once more" }))).toMatchObject({
      code: "AGENT_BUDGET",
      data: { resetsAt: expect.any(Number) },
    });
    await expect(sendToAgent(runtime, accountId, { opId, text: "Again" })).resolves.toStrictEqual(
      second,
    );
    await expect(library.agent.status()).resolves.toMatchObject({ turnsLeft: 0 });
    const { threads } = await library.agent.list({});
    expect(threads).toHaveLength(2);
  });

  it("stops a turn begun past the day's turns before its first model call", async () => {
    const { accountId, library } = await personalLibrary();
    await turnIn(accountId, "Hello");
    const threadId = await turnIn(accountId, "Again");
    const row = await threadOf(accountId, threadId);
    const sessionId = row?.eveSessionId ?? "";
    await runtime.platform.send({ accountId, eveSessionNumber: 1, threadId }, sessionId, {
      text: CREATE_NOTE,
    });
    await platform.turnsSettled();

    const shown = await shownIn(library, threadId);
    expect(shown.slice(-2)).toStrictEqual([
      { text: CREATE_NOTE, type: "user.message" },
      { reason: "allowance", turn: 2, type: "turn.ended" },
    ]);
    await expect(library.items.list({})).resolves.toMatchObject({ items: [] });
    await expect(threadOf(accountId, threadId)).resolves.toMatchObject({ status: "idle" });
  });

  it("gives back none of the day's turns when a conversation is deleted", async () => {
    const { accountId } = await personalLibrary();
    await turnIn(accountId, "Hello");
    const threadId = await turnIn(accountId, "Again");
    await deleteAgentThread(runtime, accountId, threadId);
    await settled();

    expect(await refusalOf(sendToAgent(runtime, accountId, { text: "Once more" }))).toMatchObject({
      code: "AGENT_BUDGET",
    });
  });

  it("stops a turn after the model call that passes the account's dollars", async () => {
    const { accountId, library } = await personalLibrary();
    const threadId = await turnIn(accountId, `${CREATE_NOTE}\ntokens 60000`);

    const shown = await shownIn(library, threadId);
    expect(shown.map(({ type }) => type)).toStrictEqual([
      "user.message",
      "agent.tool_use",
      "agent.tool_result",
      "turn.ended",
    ]);
    expect(shown.at(-1)).toStrictEqual({ reason: "budget", turn: 1, type: "turn.ended" });
    await expect(library.items.list({})).resolves.toMatchObject({ items: [{ title: "Garden" }] });
    const [turn] = await db.select().from(agentTurn).where(eq(agentTurn.threadId, threadId));
    expect(turn).toMatchObject({ outcome: "budget", stopReason: "budget" });
    expect(await refusalOf(sendToAgent(runtime, accountId, { text: "Hello" }))).toMatchObject({
      code: "AGENT_BUDGET",
    });
    await expect(library.agent.status()).resolves.toMatchObject({ turnsLeft: 0 });
  });

  it("charges the account no dollars for a model call on the person's own key, and lifts the day's turns", async () => {
    const { accountId, library } = await personalLibrary();
    await library.agent.setModelKey({ key: OWN_KEY });
    const threadId = await turnIn(accountId, `${CREATE_NOTE}\ntokens 60000`);

    const shown = await shownIn(library, threadId);
    expect(shown.at(-1)).toMatchObject({ reason: "done", type: "turn.ended" });

    const spent = await db
      .select({ cost: agentUsage.costMicroUsd, kind: agentUsage.kind })
      .from(agentUsage)
      .where(eq(agentUsage.accountId, accountId));

    expect(spent.filter(({ kind }) => kind === "model").length).toBeGreaterThan(0);
    expect(spent.every(({ cost }) => cost === 0)).toBe(true);
    await expect(library.agent.status()).resolves.toMatchObject({ turnsLeft: 199 });

    await library.agent.setModelKey({ key: null });
    await expect(library.agent.status()).resolves.toMatchObject({ turnsLeft: 1 });
  });

  it("stops a turn at its 21st model call, after its 20th step", async () => {
    const { accountId, library } = await personalLibrary();
    const calls = Array.from({ length: 21 }, () => "call list_items {}").join("\n");
    const threadId = await turnIn(accountId, calls);

    const shown = await shownIn(library, threadId);
    expect(shown.filter(({ type }) => type === "agent.tool_result")).toHaveLength(20);
    expect(shown.at(-1)).toStrictEqual({ reason: "steps", turn: 1, type: "turn.ended" });
    expect(shown.map((event) => agentEventSchema.parse(event).type)).not.toContain("agent.message");
  });

  it("refuses every account's sends while every account's dollars are spent", async () => {
    const spender = await makeAccount();

    const spent = {
      accountId: spender,
      at: Date.now(),
      costMicroUsd: 5_000_000,
      eveSessionNumber: 1,
      index: 0,
      kind: "model",
      line: 0,
      threadId: randomUUID(),
    } as const;

    await db.insert(agentUsage).values(spent);

    try {
      const { accountId } = await personalLibrary();
      expect(await refusalOf(sendToAgent(runtime, accountId, { text: "Hello" }))).toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        data: { resetsAt: expect.any(Number) },
      });
    } finally {
      await db.delete(agentUsage).where(eq(agentUsage.accountId, spender));
    }
  });
});
