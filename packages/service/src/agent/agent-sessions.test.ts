import { randomUUID } from "node:crypto";

import { agentEventSchema } from "@repo/contract/library/agent-events";
import { paragraph } from "@repo/contract/test-support/library-items.test-utils";
import { agentThread, agentThreadEvent, agentTurn } from "@repo/db/agent-schema";
import { db } from "@repo/db/drizzle-client";
import { changeSet } from "@repo/db/library-schema";
import { dbSuite } from "@repo/db/test-database";
import { and, count, eq, inArray } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";

import {
  createFakeAgentPlatform,
  fakeAgentRuntime,
} from "../test-support/fake-agent-platform.test-utils";
import type { FakeAgentPlatform } from "../test-support/fake-agent-platform.test-utils";
import { personalLibrary } from "../test-support/library.fixture";
import { caughtUp, readStream, rowsOf } from "../test-support/thread-reads.test-utils";
import { runAgentCron } from "./agent-cron";
import { mintLibraryId } from "../library/library-ids";
import { cancelAgentTurn, deleteAgentThread, sendToAgent } from "./agent-sessions";
import type { AgentRuntime } from "./runtime";

const CREATE_NOTE = 'call create_note {"markdown":"Water the **garden**.","title":"Garden"}';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const deleting = (id: string) => `call delete_items {"ids":["${id}"]}`;

const noteOf = (title: string) => ({
  blocks: [{ block: paragraph(randomUUID(), title), section: "note" as const }],
  folderId: null,
  id: mintLibraryId(Date.now()),
  savedAt: Date.now(),
  tags: [],
  title,
});

let platform: FakeAgentPlatform;
let runtime: AgentRuntime;
let settled: () => Promise<void>;

beforeEach(() => {
  platform = createFakeAgentPlatform();
  ({ runtime, settled } = fakeAgentRuntime(platform));
});

type Library = Awaited<ReturnType<typeof personalLibrary>>["library"];

const keptOf = async (library: Library, threadId: string, lastEventId?: string) =>
  rowsOf(await readStream(await library.agent.events({ threadId }, { lastEventId }), caughtUp));

const rowCounts = async (threadId: string) => {
  const [events] = await db
    .select({ n: count() })
    .from(agentThreadEvent)
    .where(eq(agentThreadEvent.threadId, threadId));

  const [turns] = await db
    .select({ n: count() })
    .from(agentTurn)
    .where(eq(agentTurn.threadId, threadId));

  const [threads] = await db
    .select({ n: count() })
    .from(agentThread)
    .where(eq(agentThread.id, threadId));

  return { events: events?.n ?? 0, threads: threads?.n ?? 0, turns: turns?.n ?? 0 };
};

dbSuite("the built-in agent's conversations", () => {
  it("makes a note by a call directive as the turn, keeping the turn's events in order", async () => {
    const { accountId, library } = await personalLibrary();

    const { status, threadId } = await sendToAgent(runtime, accountId, {
      opId: randomUUID(),
      text: CREATE_NOTE,
    });

    expect(status).toBe("running");
    await platform.turnsSettled();

    const events = await keptOf(library, threadId);
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

    const { items } = await library.items.list({});
    expect(items).toMatchObject([{ kind: "note", title: "Garden" }]);
    const [set] = await db.select().from(changeSet).where(eq(changeSet.threadId, threadId));
    expect(set).toMatchObject({ accountId, turn: 1 });
    expect(set?.sealedAt).not.toBeNull();

    const { threads } = await library.agent.list({});
    expect(threads).toMatchObject([{ id: threadId, status: "idle", title: CREATE_NOTE }]);
    const after = await keptOf(library, threadId, events[2]?.eventId);
    expect(after.map(({ type }) => type)).toStrictEqual(["agent.message", "turn.ended"]);
  });

  it("keeps one row for a fact its hook was delivered twice", async () => {
    const { accountId } = await personalLibrary();
    const { threadId } = await sendToAgent(runtime, accountId, { text: CREATE_NOTE });
    await platform.turnsSettled();
    const before = await rowCounts(threadId);
    expect(before).toStrictEqual({ events: 5, threads: 1, turns: 1 });

    const sessionId = platform.sessionFor(threadId, 1);
    expect(sessionId).toBeDefined();
    await platform.replayHooks(sessionId ?? "");
    await expect(rowCounts(threadId)).resolves.toStrictEqual(before);
  });

  it("sends a later message to the thread's session, once under its op id, numbering its turns", async () => {
    const { accountId, library } = await personalLibrary();
    const { threadId } = await sendToAgent(runtime, accountId, { text: "Hello" });
    await platform.turnsSettled();
    const opId = randomUUID();
    await sendToAgent(runtime, accountId, { opId, text: "Again", threadId });
    await platform.turnsSettled();
    await sendToAgent(runtime, accountId, { opId, text: "Again", threadId });
    await platform.turnsSettled();

    const sessionId = platform.sessionFor(threadId, 1) ?? "";
    expect(platform.session(sessionId).sent.map(({ text }) => text)).toStrictEqual([
      "Hello",
      "Again",
    ]);
    const events = await keptOf(library, threadId);
    const ended = events.flatMap(({ event, type }) => (type === "turn.ended" ? [event] : []));
    expect(ended).toMatchObject([{ turn: 1 }, { turn: 2 }]);
  });

  it("opens one thread for a first message sent twice under its op id", async () => {
    const { accountId, library } = await personalLibrary();
    const opId = randomUUID();
    const first = await sendToAgent(runtime, accountId, { opId, text: "Hello" });
    const again = await sendToAgent(runtime, accountId, { opId, text: "Hello" });
    await platform.turnsSettled();
    expect(again.threadId).toBe(first.threadId);
    const { threads } = await library.agent.list({});
    expect(threads).toHaveLength(1);
    expect(platform.session(platform.sessionFor(first.threadId, 1) ?? "").sent).toHaveLength(1);
  });

  it("stops a running turn, which ends cancelled and leaves its thread idle", async () => {
    const { accountId, library } = await personalLibrary();
    const { threadId } = await sendToAgent(runtime, accountId, { text: "long 6000" });
    const stopped = await cancelAgentTurn(runtime, accountId, threadId);
    await platform.turnsSettled();

    expect(stopped).toStrictEqual({ status: "idle", threadId });
    const events = await keptOf(library, threadId);
    expect(events.map(({ type }) => type)).toStrictEqual(["user.message", "turn.ended"]);
    expect(events.at(-1)?.event).toMatchObject({ reason: "cancelled", turn: 1 });
    const [turn] = await db.select().from(agentTurn).where(eq(agentTurn.threadId, threadId));
    expect(turn).toMatchObject({ number: 1, outcome: "cancelled" });
  });

  it("joins a message sent while a turn runs to that turn, which reads it before replying", async () => {
    const { accountId, library } = await personalLibrary();
    const { threadId } = await sendToAgent(runtime, accountId, { text: "long 300" });
    const joined = await sendToAgent(runtime, accountId, { text: "And this too", threadId });
    expect(joined).toStrictEqual({ status: "running", threadId });
    await platform.turnsSettled();

    const turns = await db.select().from(agentTurn).where(eq(agentTurn.threadId, threadId));
    expect(turns).toMatchObject([{ number: 1, outcome: "done" }]);
    const events = await keptOf(library, threadId);

    const said = events
      .map(({ event }) => agentEventSchema.parse(event))
      .flatMap((event) => (event.type === "user.message" ? [event.text] : []));

    expect(said).toStrictEqual(["long 300", "And this too"]);
    expect(events.map(({ type }) => type)).toStrictEqual([
      "user.message",
      "user.message",
      "agent.message",
      "turn.ended",
    ]);
    expect(events.at(-2)?.event).toMatchObject({ text: "You said: And this too" });
    expect(events.at(-1)?.event).toMatchObject({ reason: "done", turn: 1 });
  });

  it("hands the model the screen each message was sent from, for its own turn alone", async () => {
    const { accountId, library } = await personalLibrary();
    const screen = { itemId: mintLibraryId(Date.now()), surface: "item" as const };
    const sent = await sendToAgent(runtime, accountId, { text: "context", viewContext: screen });
    await platform.turnsSettled();
    await sendToAgent(runtime, accountId, { text: "context", threadId: sent.threadId });
    await platform.turnsSettled();

    const events = await keptOf(library, sent.threadId);
    const replies = events.flatMap(({ event, type }) => (type === "agent.message" ? [event] : []));
    expect(replies).toStrictEqual([
      { text: `Sent from: ${JSON.stringify(screen)}`, type: "agent.message" },
      { text: "Sent from: nowhere", type: "agent.message" },
    ]);
  });

  it("brings back by Undo this turn and Undo this conversation the items its turns deleted", async () => {
    const { accountId, library } = await personalLibrary();
    const first = noteOf("First");
    const second = noteOf("Second");
    await library.items.create(first);
    await library.items.create(second);
    const { threadId } = await sendToAgent(runtime, accountId, { text: deleting(first.id) });
    await platform.turnsSettled();
    await sendToAgent(runtime, accountId, { text: deleting(second.id), threadId });
    await platform.turnsSettled();
    await expect(library.items.list({})).resolves.toMatchObject({ items: [] });
    await expect(library.agent.undoable({ threadId })).resolves.toStrictEqual({ turns: [1, 2] });

    await expect(library.agent.undo({ threadId, turn: 2 })).resolves.toMatchObject({
      reverted: [second.id],
    });
    await expect(library.agent.undoable({ threadId })).resolves.toStrictEqual({ turns: [1] });
    await expect(library.agent.undo({ threadId })).resolves.toMatchObject({
      next: null,
      reverted: [first.id],
    });
    const { items } = await library.items.list({});
    expect(items.map(({ id }) => id).toSorted()).toStrictEqual([first.id, second.id].toSorted());
    await expect(library.agent.undoable({ threadId })).resolves.toStrictEqual({ turns: [] });
  });

  it("starts the thread's next eve session once its session ended, numbering on", async () => {
    const { accountId, library } = await personalLibrary();
    const { threadId } = await sendToAgent(runtime, accountId, { text: "Hello" });
    await platform.turnsSettled();
    await platform.expire(platform.sessionFor(threadId, 1) ?? "");
    await sendToAgent(runtime, accountId, { text: "Still there?", threadId });
    await platform.turnsSettled();

    const next = platform.sessionFor(threadId, 2);
    expect(next).toBeDefined();
    expect(platform.session(next ?? "").sent.map(({ text }) => text)).toStrictEqual([
      "Still there?",
    ]);
    const events = await keptOf(library, threadId);
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

  it("starts the thread's next eve session once its session is a week old, ending the old one", async () => {
    const { accountId, library } = await personalLibrary();
    const { threadId } = await sendToAgent(runtime, accountId, { text: "Hello" });
    await platform.turnsSettled();
    await db
      .update(agentThread)
      .set({ eveSessionStartedAt: Date.now() - WEEK_MS })
      .where(and(eq(agentThread.accountId, accountId), eq(agentThread.id, threadId)));
    await sendToAgent(runtime, accountId, { text: "A week on", threadId });
    await platform.turnsSettled();
    await settled();

    expect(platform.session(platform.sessionFor(threadId, 1) ?? "").ended).toBe(true);
    const next = platform.sessionFor(threadId, 2) ?? "";
    expect(platform.session(next).sent.map(({ text }) => text)).toStrictEqual(["A week on"]);
    const events = await keptOf(library, threadId);
    expect(events.at(-1)?.event).toMatchObject({ reason: "done", turn: 2 });
  });

  it("reaches no other account's thread", async () => {
    const owner = await personalLibrary();
    const other = await personalLibrary();
    const { threadId } = await sendToAgent(runtime, owner.accountId, { text: "Mine" });
    await platform.turnsSettled();
    await expect(
      sendToAgent(runtime, other.accountId, { text: "Theirs", threadId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.library.agent.events({ threadId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(cancelAgentTurn(runtime, other.accountId, threadId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(deleteAgentThread(runtime, other.accountId, threadId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("deletes a thread out of reach at once, then its rows and its eve session", async () => {
    const { accountId, library } = await personalLibrary();
    const { threadId } = await sendToAgent(runtime, accountId, { text: CREATE_NOTE });
    await platform.turnsSettled();
    await expect(deleteAgentThread(runtime, accountId, threadId)).resolves.toStrictEqual({
      deleted: true,
    });
    await expect(library.agent.list({})).resolves.toMatchObject({ threads: [] });
    await expect(library.agent.events({ threadId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(sendToAgent(runtime, accountId, { text: "Hi", threadId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    await settled();
    await expect(rowCounts(threadId)).resolves.toStrictEqual({ events: 0, threads: 0, turns: 0 });
    expect(platform.session(platform.sessionFor(threadId, 1) ?? "").ended).toBe(true);
  });

  it("purges by the agent's cron a deleted thread whose session couldn't be ended then", async () => {
    const { accountId } = await personalLibrary();
    const { threadId } = await sendToAgent(runtime, accountId, { text: "Hello" });
    await platform.turnsSettled();
    await deleteAgentThread(null, accountId, threadId);
    await expect(rowCounts(threadId)).resolves.toMatchObject({ threads: 1 });

    const { threads } = await runAgentCron(runtime);
    expect(threads.failed).toBe(0);
    expect(threads.purged).toBeGreaterThanOrEqual(1);
    await expect(rowCounts(threadId)).resolves.toStrictEqual({ events: 0, threads: 0, turns: 0 });
    expect(platform.session(platform.sessionFor(threadId, 1) ?? "").ended).toBe(true);
  });

  it("settles by the agent's cron a turn stranded open, idling its thread, sealing its set and keeping its end once", async () => {
    const { accountId, library } = await personalLibrary();
    const { threadId } = await sendToAgent(runtime, accountId, { text: CREATE_NOTE });
    await platform.turnsSettled();
    const strandedAt = Date.now() - 2 * 60 * 60 * 1000;
    const turn = and(eq(agentTurn.threadId, threadId), eq(agentTurn.number, 1));
    await db
      .update(agentTurn)
      .set({ outcome: null, settledAt: null, startedAt: strandedAt })
      .where(turn);
    await db.update(agentThread).set({ status: "running" }).where(eq(agentThread.id, threadId));
    await db.update(changeSet).set({ sealedAt: null }).where(eq(changeSet.threadId, threadId));
    await db
      .delete(agentThreadEvent)
      .where(and(eq(agentThreadEvent.threadId, threadId), eq(agentThreadEvent.type, "turn.ended")));
    await expect(library.agent.undoable({ threadId })).resolves.toStrictEqual({ turns: [] });
    const { head } = await library.changes({});

    const { turns } = await runAgentCron(runtime);
    expect(turns.settled).toBeGreaterThanOrEqual(1);
    expect(turns.sealed).toBeGreaterThanOrEqual(1);
    const [failed] = await db.select().from(agentTurn).where(turn);
    expect(failed).toMatchObject({ outcome: "failed" });
    const { threads } = await library.agent.list({});
    expect(threads).toMatchObject([{ id: threadId, status: "idle" }]);
    await expect(library.agent.undoable({ threadId })).resolves.toStrictEqual({ turns: [1] });
    await expect(library.changes({ after: head })).resolves.toMatchObject({
      moved: { threads: [threadId] },
    });
    const ended = { reason: "failed", turn: 1, type: "turn.ended" };
    const kept = await keptOf(library, threadId);
    expect(kept.at(-1)?.event).toStrictEqual(ended);

    await platform.replayHooks(platform.sessionFor(threadId, 1) ?? "");
    const again = await keptOf(library, threadId);
    expect(again.filter(({ type }) => type === "turn.ended")).toMatchObject([{ event: ended }]);
  });

  it("tries a deleted thread whose session can't be ended after those not tried since, so it never starves them", async () => {
    const retiredThread = async (text: string) => {
      const { accountId } = await personalLibrary();
      const { threadId } = await sendToAgent(runtime, accountId, { text });
      await platform.turnsSettled();
      await deleteAgentThread(null, accountId, threadId);

      return threadId;
    };

    const stuck = new Set<string>();
    const stuckThreads: string[] = [];

    for (const text of ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"]) {
      const threadId = await retiredThread(text);
      stuck.add(platform.sessionFor(threadId, 1) ?? "");
      stuckThreads.push(threadId);
    }

    const failing: AgentRuntime = {
      ...runtime,
      platform: {
        ...platform,
        end: async (caller, sessionId) => {
          if (stuck.has(sessionId)) {
            throw new Error("eve is away");
          }

          return await platform.end(caller, sessionId);
        },
      },
    };

    const allTried = async () => {
      const rows = await db
        .select({ triedAt: agentThread.purgeTriedAt })
        .from(agentThread)
        .where(inArray(agentThread.id, stuckThreads));

      return rows.every(({ triedAt }) => triedAt !== null);
    };

    while (!(await allTried())) {
      await runAgentCron(failing);
    }

    const later: string[] = [];

    for (const text of ["Nine", "Ten", "Eleven"]) {
      later.push(await retiredThread(text));
    }

    const second = await runAgentCron(failing);
    expect(second.threads).toMatchObject({ purged: later.length });

    for (const threadId of later) {
      await expect(rowCounts(threadId)).resolves.toMatchObject({ threads: 0 });
    }
  });

  it("answers that the agent can't be reached while the deployment reaches no model", async () => {
    const { accountId } = await personalLibrary();
    await expect(sendToAgent(null, accountId, { text: "Hello" })).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });
});
