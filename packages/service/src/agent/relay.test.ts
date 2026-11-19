import { setTimeout as sleep } from "node:timers/promises";

import { dbSuite } from "@repo/db/test-database";
import { beforeEach, expect, it } from "vitest";

import {
  createFakeAgentPlatform,
  fakeAgentRuntime,
} from "../test-support/fake-agent-platform.test-utils";
import type { FakeAgentPlatform } from "../test-support/fake-agent-platform.test-utils";
import { personalLibrary } from "../test-support/library.fixture";
import type { Streamed } from "../test-support/thread-reads.test-utils";
import { caughtUp, readStream, rowsOf, shownOf } from "../test-support/thread-reads.test-utils";
import { deleteAgentThread, sendToAgent } from "./agent-sessions";
import { followThread } from "./relay";
import type { AgentRuntime } from "./runtime";

const CREATE_NOTE = 'call create_note {"markdown":"Plant the beans.","title":"Beans"}';

let platform: FakeAgentPlatform;
let runtime: AgentRuntime;
let settled: () => Promise<void>;

beforeEach(() => {
  platform = createFakeAgentPlatform();
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

const idsOf = (read: readonly Streamed[]) => rowsOf(read).map(({ eventId }) => eventId);

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

  it("shows a live turn's end once its settle is kept, so what Undo takes back counts it", async () => {
    const { accountId, library } = await personalLibrary();

    const { threadId } = await sendToAgent(runtime, accountId, {
      text: `${CREATE_NOTE}\nlong 300`,
    });

    await follow(accountId, threadId, endsTurn(1));
    await expect(library.agent.undoable({ threadId })).resolves.toStrictEqual({ turns: [1] });
    const { threads } = await library.agent.list({});
    expect(threads).toMatchObject([{ id: threadId, status: "idle" }]);
    await platform.turnsSettled();
  });

  it("holds a live turn's end its settle is kept late, nothing after it first, then streams every event once", async () => {
    const { accountId } = await personalLibrary();
    const release = platform.holdHooks("turn.settled");
    const { threadId } = await sendToAgent(runtime, accountId, { text: "Hello" });
    await platform.turnsSettled();

    let sofar: readonly Streamed[] = [];

    const reading = follow(accountId, threadId, (read) => {
      sofar = read;

      return endsTurn(2)(read);
    });

    await sendToAgent(runtime, accountId, { text: "Again", threadId });
    await platform.turnsSettled();
    await sleep(1500);
    expect(shownOf(sofar).map(({ type }) => type)).toStrictEqual(["user.message", "agent.message"]);

    await release();
    const read = await reading;
    const whole = await follow(accountId, threadId, caughtUp);
    expect(idsOf(read)).toStrictEqual(idsOf(whole));
    expect(new Set(idsOf(read)).size).toBe(idsOf(read).length);
    expect(shownOf(read).map(({ type }) => type)).toStrictEqual([
      "user.message",
      "agent.message",
      "turn.ended",
      "user.message",
      "agent.message",
      "turn.ended",
    ]);
  });

  it("holds a live turn's end whose turn is kept after it, and streams every event once", async () => {
    const { accountId } = await personalLibrary();
    const { threadId } = await sendToAgent(runtime, accountId, { text: "Hello" });
    await platform.turnsSettled();

    let sofar: readonly Streamed[] = [];

    const reading = follow(accountId, threadId, (read) => {
      sofar = read;

      return endsTurn(2)(read);
    });

    const releaseStart = platform.holdHooks("turn.started");
    const releaseSettle = platform.holdHooks("turn.settled");
    await sendToAgent(runtime, accountId, { text: "Again", threadId });
    await platform.turnsSettled();
    await sleep(500);
    expect(shownOf(sofar).map(({ type }) => type)).toStrictEqual([
      "user.message",
      "agent.message",
      "turn.ended",
      "user.message",
      "agent.message",
    ]);

    await releaseStart();
    await releaseSettle();
    const read = await reading;
    const whole = await follow(accountId, threadId, caughtUp);
    expect(idsOf(read)).toStrictEqual(idsOf(whole));
    expect(new Set(idsOf(read)).size).toBe(idsOf(read).length);
    expect(shownOf(read).map(({ type }) => type)).toStrictEqual([
      "user.message",
      "agent.message",
      "turn.ended",
      "user.message",
      "agent.message",
      "turn.ended",
    ]);
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
