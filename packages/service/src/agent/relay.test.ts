// A thread followed through the relay over the fake platform: what it kept, then what happens live,
// the reply's draft before its message, and a reconnect by the last id read that resumes with
// nothing missed or repeated, wherever the stream was cut.

import { dbSuite } from "@repo/db/test-database";
import { beforeEach, expect, it } from "vitest";

import { createFakeAgentPlatform, fakeAgentRuntime } from "../test-support/fake-agent-platform";
import type { FakeAgentPlatform } from "../test-support/fake-agent-platform";
import { personalLibrary } from "../test-support/library-fixture";
import type { Streamed } from "../test-support/thread-reads";
import { caughtUp, readStream, rowsOf, shownOf } from "../test-support/thread-reads";
import { deleteAgentThread, sendToAgent } from "./agent-sessions";
import { recordEveFact } from "./eve-agent";
import { followThread } from "./relay";
import type { AgentRuntime } from "./runtime";

const CREATE_NOTE = 'call create_note {"markdown":"Plant the beans.","title":"Beans"}';

let platform: FakeAgentPlatform;
let runtime: AgentRuntime;
let settled: () => Promise<void>;

beforeEach(() => {
  platform = createFakeAgentPlatform(recordEveFact);
  ({ runtime, settled } = fakeAgentRuntime(platform));
});

const follow = async (
  accountId: string,
  threadId: string,
  done: (read: readonly Streamed[]) => boolean,
  lastEventId?: string,
) => {
  const stop = new AbortController();
  const stream = await followThread(runtime, accountId, threadId, {
    lastEventId,
    pollMs: 10,
    signal: stop.signal,
  });
  try {
    return await readStream(stream, done);
  } finally {
    stop.abort();
  }
};

const endsTurn = (turn: number) => (read: readonly Streamed[]) =>
  shownOf(read).some((event) => event.type === "turn.ended" && event.turn === turn);

const idsOf = (read: readonly Streamed[]): string[] => rowsOf(read).map(({ eventId }) => eventId);

dbSuite("a thread followed as it happens", () => {
  it("streams what the thread kept, then caughtUp, then the turn live with its reply's draft", async () => {
    const { accountId } = await personalLibrary();
    const { threadId } = await sendToAgent(runtime, accountId, { text: CREATE_NOTE });
    await platform.turnsSettled();
    await sendToAgent(runtime, accountId, { text: "long 300", threadId });

    const read = await follow(accountId, threadId, endsTurn(2));
    await platform.turnsSettled();
    const kinds = read.map(({ event }) => event.kind);
    const caughtAt = kinds.indexOf("caughtUp");
    expect(kinds.slice(0, 5)).toStrictEqual(["event", "event", "event", "event", "event"]);
    expect(caughtAt).toBeGreaterThanOrEqual(5);

    const drafts = read.flatMap(({ event }) => (event.kind === "draft" ? [event.text] : []));
    expect(drafts.join("")).toBe("x".repeat(300));
    const kept = read.findIndex(
      ({ event }) => event.kind === "event" && event.row.type === "agent.message",
    );
    const replied = read.findIndex(
      (each, index) =>
        index > caughtAt && each.event.kind === "event" && each.event.row.type === "agent.message",
    );
    expect(kept).toBeLessThan(caughtAt);
    expect(read.findIndex(({ event }) => event.kind === "draft")).toBeLessThan(replied);
    expect(read.flatMap(({ event, id }) => (event.kind === "event" ? [id] : []))).toStrictEqual(
      idsOf(read),
    );
    expect(read.some(({ event, id }) => event.kind === "draft" && id !== undefined)).toBe(false);
  });

  it("resumes after the last id read, mid-history and mid-turn, with nothing missed or repeated", async () => {
    const { accountId } = await personalLibrary();
    const { threadId } = await sendToAgent(runtime, accountId, { text: CREATE_NOTE });
    await platform.turnsSettled();

    const firstPart = await follow(accountId, threadId, (read) => rowsOf(read).length === 2);
    const rest = await follow(accountId, threadId, caughtUp, idsOf(firstPart).at(-1));
    const whole = await follow(accountId, threadId, caughtUp);
    expect([...idsOf(firstPart), ...idsOf(rest)]).toStrictEqual(idsOf(whole));

    await sendToAgent(runtime, accountId, { text: "long 300", threadId });
    const beforeCut = await follow(
      accountId,
      threadId,
      (read) =>
        caughtUp(read) &&
        rowsOf(read.slice(read.findIndex(({ event }) => event.kind === "caughtUp"))).length > 0,
      idsOf(whole).at(-1),
    );
    const afterCut = await follow(accountId, threadId, endsTurn(2), idsOf(beforeCut).at(-1));
    await platform.turnsSettled();
    const after = await follow(accountId, threadId, caughtUp, idsOf(whole).at(-1));

    const resumed = [...idsOf(beforeCut), ...idsOf(afterCut)];
    expect(new Set(resumed).size).toBe(resumed.length);
    expect(resumed).toStrictEqual(idsOf(after));
    expect(rowsOf(after).map(({ type }) => type)).toStrictEqual([
      "user.message",
      "agent.message",
      "turn.ended",
    ]);
  });

  it("follows a thread into its next eve session", async () => {
    const { accountId } = await personalLibrary();
    const { threadId } = await sendToAgent(runtime, accountId, { text: "Hello" });
    await platform.turnsSettled();
    await platform.expire(platform.sessionFor(threadId, 1) ?? "");

    const reading = follow(accountId, threadId, endsTurn(2));
    await sendToAgent(runtime, accountId, { text: "Still there?", threadId });
    const read = await reading;
    await platform.turnsSettled();
    expect(idsOf(read).map((id) => id.split(":")[0])).toStrictEqual(["1", "1", "1", "2", "2", "2"]);
  });

  it("ends once its thread is deleted", async () => {
    const { accountId } = await personalLibrary();
    const { threadId } = await sendToAgent(runtime, accountId, { text: "Hello" });
    await platform.turnsSettled();

    const deleting: Promise<void>[] = [];
    const read = await follow(accountId, threadId, (sofar) => {
      if (caughtUp(sofar) && deleting.length === 0) {
        deleting.push(deleteAgentThread(runtime, accountId, threadId).then(settled));
      }
      return false;
    });
    await Promise.all(deleting);
    expect(caughtUp(read)).toBe(true);
  });
});
