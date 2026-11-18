// The built-in agent's conversations over the fake platform, which plays the mock model's script and
// runs its calls as eve runs the agent's tools: what a send makes in the library, what the record
// hook keeps of it, and how a thread moves across its eve sessions.

import { randomUUID } from "node:crypto";

import { agentThreadEvent, agentTurn } from "@repo/db/agent-schema";
import { db } from "@repo/db/drizzle-client";
import { changeSet } from "@repo/db/library-schema";
import { dbSuite } from "@repo/db/test-database";
import { count, eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";

import { createFakeAgentPlatform, fakeAgentRuntime } from "../test-support/fake-agent-platform";
import type { FakeAgentPlatform } from "../test-support/fake-agent-platform";
import { personalLibrary } from "../test-support/library-fixture";
import { cancelAgentTurn, deleteAgentThread, sendToAgent } from "./agent-sessions";
import { recordEveFact } from "./eve-agent";
import type { AgentRuntime } from "./runtime";

const CREATE_NOTE = 'call create_note {"markdown":"Water the **garden**.","title":"Garden"}';

let platform: FakeAgentPlatform;
let runtime: AgentRuntime;
let settled: () => Promise<void>;

beforeEach(() => {
  platform = createFakeAgentPlatform(recordEveFact);
  ({ runtime, settled } = fakeAgentRuntime(platform));
});

type Library = Awaited<ReturnType<typeof personalLibrary>>["library"];

const eventsOf = async (library: Library, threadId: string) => {
  const { events } = await library.agent.events({ threadId });
  return events;
};

const rowsOf = async (threadId: string) => {
  const [events] = await db
    .select({ n: count() })
    .from(agentThreadEvent)
    .where(eq(agentThreadEvent.threadId, threadId));
  const [turns] = await db
    .select({ n: count() })
    .from(agentTurn)
    .where(eq(agentTurn.threadId, threadId));
  return { events: events?.n ?? 0, turns: turns?.n ?? 0 };
};

dbSuite("the built-in agent's conversations", () => {
  it("makes a note by a call directive as the turn, keeping the turn's events in order", async () => {
    const { accountId, library } = await personalLibrary();
    const { status, threadId } = await sendToAgent(runtime, accountId, {
      opId: randomUUID(),
      text: CREATE_NOTE,
    });
    expect(status).toBe("running");

    const events = await eventsOf(library, threadId);
    expect(events.map(({ type }) => type)).toStrictEqual([
      "user.message",
      "agent.tool_use",
      "agent.tool_result",
      "agent.message",
      "turn.ended",
    ]);
    expect(events.map(({ event }) => event)).toMatchObject([
      { text: CREATE_NOTE, type: "user.message" },
      { input: { markdown: "Water the **garden**.", title: "Garden" }, name: "create_note" },
      { isError: false },
      { text: "Done: create_note", type: "agent.message" },
      { reason: "done", turn: 1, type: "turn.ended" },
    ]);
    expect(events.map(({ idx }) => idx)).toStrictEqual(
      events.map(({ idx }) => idx).toSorted((left, right) => left - right),
    );

    const { items } = await library.items.list({});
    expect(items).toMatchObject([{ kind: "note", title: "Garden" }]);
    const [set] = await db.select().from(changeSet).where(eq(changeSet.threadId, threadId));
    expect(set).toMatchObject({ accountId, turn: 1 });
    expect(set?.sealedAt).not.toBeNull();

    const { threads } = await library.agent.list({});
    expect(threads).toMatchObject([{ id: threadId, status: "idle", title: CREATE_NOTE }]);
    const after = await library.agent.events({ after: events[2]?.idx ?? 0, threadId });
    expect(after.events.map(({ type }) => type)).toStrictEqual(["agent.message", "turn.ended"]);
  });

  it("keeps one row for a fact its hook was delivered twice", async () => {
    const { accountId } = await personalLibrary();
    const { threadId } = await sendToAgent(runtime, accountId, { text: CREATE_NOTE });
    const before = await rowsOf(threadId);
    expect(before).toStrictEqual({ events: 5, turns: 1 });

    const sessionId = platform.sessionFor(threadId, 1);
    expect(sessionId).toBeDefined();
    await platform.replayHooks(sessionId ?? "");
    await expect(rowsOf(threadId)).resolves.toStrictEqual(before);
  });

  it("sends a later message to the thread's session, once under its op id, numbering its turns", async () => {
    const { accountId, library } = await personalLibrary();
    const { threadId } = await sendToAgent(runtime, accountId, { text: "Hello" });
    const opId = randomUUID();
    await sendToAgent(runtime, accountId, { opId, text: "Again", threadId });
    await sendToAgent(runtime, accountId, { opId, text: "Again", threadId });

    const sessionId = platform.sessionFor(threadId, 1) ?? "";
    expect(platform.session(sessionId).sent.map(({ text }) => text)).toStrictEqual([
      "Hello",
      "Again",
    ]);
    const events = await eventsOf(library, threadId);
    const ended = events.flatMap(({ event, type }) => (type === "turn.ended" ? [event] : []));
    expect(ended).toMatchObject([{ turn: 1 }, { turn: 2 }]);
  });

  it("opens one thread for a first message sent twice under its op id", async () => {
    const { accountId, library } = await personalLibrary();
    const opId = randomUUID();
    const first = await sendToAgent(runtime, accountId, { opId, text: "Hello" });
    const again = await sendToAgent(runtime, accountId, { opId, text: "Hello" });
    expect(again.threadId).toBe(first.threadId);
    const { threads } = await library.agent.list({});
    expect(threads).toHaveLength(1);
    expect(platform.session(platform.sessionFor(first.threadId, 1) ?? "").sent).toHaveLength(1);
  });

  it("starts the thread's next eve session once its session ended, numbering on", async () => {
    const { accountId, library } = await personalLibrary();
    const { threadId } = await sendToAgent(runtime, accountId, { text: "Hello" });
    await platform.expire(platform.sessionFor(threadId, 1) ?? "");
    await sendToAgent(runtime, accountId, { text: "Still there?", threadId });

    const next = platform.sessionFor(threadId, 2);
    expect(next).toBeDefined();
    expect(platform.session(next ?? "").sent.map(({ text }) => text)).toStrictEqual([
      "Still there?",
    ]);
    const events = await eventsOf(library, threadId);
    expect(events.map(({ eventId }) => eventId.split(":")[0])).toStrictEqual([
      "1",
      "1",
      "1",
      "2",
      "2",
      "2",
    ]);
    expect(events.at(-1)?.event).toMatchObject({ turn: 2, type: "turn.ended" });
  });

  it("reaches no other account's thread", async () => {
    const owner = await personalLibrary();
    const other = await personalLibrary();
    const { threadId } = await sendToAgent(runtime, owner.accountId, { text: "Mine" });
    await expect(
      sendToAgent(runtime, other.accountId, { text: "Theirs", threadId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.library.agent.events({ threadId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(cancelAgentTurn(runtime, other.accountId, threadId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("deletes the thread's rows at once and ends its eve session", async () => {
    const { accountId, library } = await personalLibrary();
    const { threadId } = await sendToAgent(runtime, accountId, { text: CREATE_NOTE });
    await expect(deleteAgentThread(runtime, accountId, threadId)).resolves.toStrictEqual({
      deleted: true,
    });
    await settled();
    await expect(rowsOf(threadId)).resolves.toStrictEqual({ events: 0, turns: 0 });
    expect(platform.session(platform.sessionFor(threadId, 1) ?? "").ended).toBe(true);
    await expect(library.agent.list({})).resolves.toMatchObject({ threads: [] });
  });

  it("answers that the agent can't be reached while the deployment reaches no model", async () => {
    const { accountId } = await personalLibrary();
    await expect(sendToAgent(null, accountId, { text: "Hello" })).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });
});
