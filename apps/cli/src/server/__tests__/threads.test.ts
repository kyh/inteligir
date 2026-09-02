import { isDefinedError, ORPCError, safe } from "@orpc/client";
import { noopNotifier } from "@repo/domain/notifier";
import { createPendingInteraction, getPendingInteraction } from "@repo/db/pending-interactions";
import { claimNextQueuedThreadMessage, listQueuedThreadMessages } from "@repo/db/queued-messages";
import { applyThreadLifecycleEvent } from "@repo/db/threads";
import { serverMessageLenientSchema, type ServerMessage } from "@repo/api/local/notifications";
import { WS_PATH } from "@repo/api/local/routes";
import type { TimelineResponse } from "@repo/api/local/threads/threads-schema";
import { applyTimelineDelta, type TimelineRow } from "@repo/api/local/thread-timeline";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { z } from "zod";
import { ThreadEventThreadIdMismatchError, ThreadService } from "../threads/service";
import { unavailableTurnDriver } from "../threads/turn-driver";
import { authorizationHeader } from "../server-file";
import {
  bootTestApp,
  bootThreadHarness,
  listenTestApp,
  TEST_SERVER_TOKEN,
  type BootedTestApp,
} from "./boot-app";

type ThreadsClient = BootedTestApp["client"];

async function createThread(client: ThreadsClient): Promise<string> {
  const { thread } = await client.threads.create({});
  return thread.id;
}

async function getThreadStatus(client: ThreadsClient, threadId: string): Promise<string> {
  const detail = await client.threads.get({ threadId });
  return detail.thread.status;
}

function fetchTimeline(client: ThreadsClient, threadId: string): Promise<TimelineResponse> {
  return client.threads.timeline({ threadId });
}

function timelineRows(response: TimelineResponse): TimelineRow[] {
  if (response.kind !== "full") {
    throw new Error("expected a full timeline");
  }
  return response.timeline.rows;
}

describe("the send policy", () => {
  it("starts a turn when the thread is idle", async () => {
    const { client } = await bootThreadHarness({ mode: "manual" });
    const threadId = await createThread(client);
    const started = await client.threads.send({ threadId, text: "hello" });
    expect(started.kind).toBe("started");
    expect(await getThreadStatus(client, threadId)).toBe("active");
  });

  it("refuses a send naming a turn that is not the open one", async () => {
    const { client } = await bootThreadHarness({ mode: "manual" });
    const threadId = await createThread(client);
    const started = await client.threads.send({ threadId, text: "start" });
    if (started.kind !== "started") {
      throw new Error("expected a started turn");
    }

    const [stale] = await safe(
      client.threads.send({
        threadId,
        text: "too late",
        expectedTurnId: "turn_stale",
      }),
    );
    expect(isDefinedError(stale) && stale.code).toBe("STALE_TURN");
  });

  it("refuses a stale expectedTurnId once the turn settled", async () => {
    const { client, driver } = await bootThreadHarness({ mode: "manual" });
    const threadId = await createThread(client);
    const started = await client.threads.send({
      threadId,
      text: "start",
    });
    if (started.kind !== "started") {
      throw new Error("expected a started turn");
    }
    driver?.completeTurn(threadId, started.turnId, "completed");
    expect(await getThreadStatus(client, threadId)).toBe("idle");

    const [stale] = await safe(
      client.threads.send({
        threadId,
        text: "after the finished turn",
        expectedTurnId: started.turnId,
      }),
    );
    expect(isDefinedError(stale) && stale.code).toBe("STALE_TURN");
  });

  it("queues while active, starting and stopping", async () => {
    const activeHarness = await bootThreadHarness({ mode: "manual" });
    const activeThread = await createThread(activeHarness.client);
    await activeHarness.client.threads.send({
      threadId: activeThread,
      text: "start",
    });
    const queuedWhileActive = await activeHarness.client.threads.send({
      threadId: activeThread,
      text: "later",
    });
    expect(queuedWhileActive.kind).toBe("queued");

    applyThreadLifecycleEvent(activeHarness.db, noopNotifier, {
      threadId: activeThread,
      event: { type: "stop.requested" },
    });
    expect(await getThreadStatus(activeHarness.client, activeThread)).toBe("stopping");
    const queuedWhileStopping = await activeHarness.client.threads.send({
      threadId: activeThread,
      text: "after the stop",
    });
    expect(queuedWhileStopping.kind).toBe("queued");

    const inertHarness = await bootThreadHarness({ mode: "inert" });
    const startingThread = await createThread(inertHarness.client);
    await inertHarness.client.threads.send({
      threadId: startingThread,
      text: "start",
    });
    expect(await getThreadStatus(inertHarness.client, startingThread)).toBe("starting");
    const queueWhileStarting = await inertHarness.client.threads.send({
      threadId: startingThread,
      text: "later",
    });
    expect(queueWhileStarting.kind).toBe("queued");
  });

  it("refuses unknown and archived threads", async () => {
    const { client } = await bootThreadHarness({ mode: "manual" });
    const [missing] = await safe(client.threads.send({ threadId: "thr_missing", text: "hi" }));
    expect(isDefinedError(missing) && missing.code).toBe("NOT_FOUND");

    const threadId = await createThread(client);
    const archived = await client.threads.archive({ threadId });
    expect(archived.thread.archivedAt).not.toBeNull();
    const [send] = await safe(client.threads.send({ threadId, text: "hi" }));
    expect(isDefinedError(send) && send.code).toBe("ARCHIVED");
  });

  it("refuses PROVIDER_UNAVAILABLE and lands the thread in error when none is configured", async () => {
    const { client } = await bootTestApp();
    const threadId = await createThread(client);
    const [send] = await safe(client.threads.send({ threadId, text: "hi" }));
    expect(isDefinedError(send) && send.code).toBe("PROVIDER_UNAVAILABLE");
    expect(await getThreadStatus(client, threadId)).toBe("error");
  });
});

describe("the view context a message carries", () => {
  const VIEW_CONTEXT = {
    surface: "doc",
    resource: "Notes/Plans.md",
    revision: "a".repeat(64),
  } as const;

  it("reaches the driver, is recorded beside the text, and never becomes the text", async () => {
    const { client, driver } = await bootThreadHarness({ mode: "manual" });
    const threadId = await createThread(client);
    const send = await client.threads.send({
      threadId,
      text: "make this shorter",
      viewContext: VIEW_CONTEXT,
    });
    expect(send.kind).toBe("started");
    expect(driver?.startedTurns[0]?.viewContext).toEqual(VIEW_CONTEXT);

    const row = timelineRows(await fetchTimeline(client, threadId)).find(
      (candidate) => candidate.kind === "conversation",
    );
    if (row?.kind !== "conversation") {
      throw new Error("expected the user's conversation row");
    }
    expect(row.text).toBe("make this shorter");
    expect(row.viewContext).toEqual(VIEW_CONTEXT);
  });

  it("is DROPPED by a queued send, which drains onto a screen the user has left", async () => {
    const { client, driver } = await bootThreadHarness({ mode: "manual" });
    if (!driver) {
      throw new Error("expected the fake driver");
    }
    const threadId = await createThread(client);
    const started = await client.threads.send({
      threadId,
      text: "first",
    });
    if (started.kind !== "started") {
      throw new Error("expected a started turn");
    }
    const queued = await client.threads.send({
      threadId,
      text: "for later",
      viewContext: VIEW_CONTEXT,
    });
    expect(queued.kind).toBe("queued");

    driver.completeTurn(threadId, started.turnId, "completed");
    expect(driver.startedTurns[1]?.text).toBe("for later");
    expect(driver.startedTurns[1]?.viewContext).toBeUndefined();

    const drained = timelineRows(await fetchTimeline(client, threadId)).find(
      (row) => row.kind === "conversation" && row.text === "for later",
    );
    if (drained?.kind !== "conversation") {
      throw new Error("expected the drained message's row");
    }
    expect(drained.viewContext).toBeNull();
  });

  it("refuses a resource that is not a vault path", async () => {
    const { client } = await bootThreadHarness({ mode: "manual" });
    const threadId = await createThread(client);
    const [error] = await safe(
      client.threads.send({
        threadId,
        text: "hi",
        viewContext: { ...VIEW_CONTEXT, resource: "../outside.md" },
      }),
    );
    // the path grammar rides the input schema, so the refusal is oRPC's own BAD_REQUEST rather than a declared class.
    expect(error instanceof ORPCError && error.code).toBe("BAD_REQUEST");
  });
});

describe("the queue drain", () => {
  it("drains queued messages one turn at a time as the thread settles idle", async () => {
    const { client, db, driver } = await bootThreadHarness({ mode: "manual" });
    if (!driver) {
      throw new Error("expected the fake driver");
    }
    const threadId = await createThread(client);
    const started = await client.threads.send({
      threadId,
      text: "first",
    });
    if (started.kind !== "started") {
      throw new Error("expected a started turn");
    }
    for (const text of ["q1", "q2"]) {
      const queued = await client.threads.send({ threadId, text });
      expect(queued.kind).toBe("queued");
    }
    expect(listQueuedThreadMessages(db, threadId)).toHaveLength(2);

    driver.completeTurn(threadId, started.turnId, "completed");
    // the drain started q1's turn, so the thread is active again, not idle.
    expect(await getThreadStatus(client, threadId)).toBe("active");
    expect(listQueuedThreadMessages(db, threadId)).toHaveLength(1);

    const q1Turn = driver.startedTurns[1];
    if (!q1Turn) {
      throw new Error("expected the drained turn");
    }
    driver.completeTurn(threadId, q1Turn.turnId, "completed");
    const q2Turn = driver.startedTurns[2];
    if (!q2Turn) {
      throw new Error("expected the second drained turn");
    }
    driver.completeTurn(threadId, q2Turn.turnId, "completed");

    expect(await getThreadStatus(client, threadId)).toBe("idle");
    expect(listQueuedThreadMessages(db, threadId)).toHaveLength(0);
    expect(driver.startedTurns.map((turn) => turn.text)).toEqual(["first", "q1", "q2"]);

    const rows = timelineRows(await fetchTimeline(client, threadId));
    expect(
      rows
        .filter((row) => row.kind === "conversation" && row.role === "user")
        .map((row) => (row.kind === "conversation" ? row.text : "")),
    ).toEqual(["first", "q1", "q2"]);
  });

  it("appends a drained message exactly once, even when its dispatch fails", async () => {
    const { client, db, driver } = await bootThreadHarness({ mode: "manual" });
    if (!driver) {
      throw new Error("expected the fake driver");
    }
    const threadId = await createThread(client);
    const started = await client.threads.send({
      threadId,
      text: "first",
    });
    if (started.kind !== "started") {
      throw new Error("expected a started turn");
    }
    await client.threads.send({ threadId, text: "queued" });

    driver.failNextStart = new Error("boom");
    driver.completeTurn(threadId, started.turnId, "completed");
    expect(await getThreadStatus(client, threadId)).toBe("error");
    expect(listQueuedThreadMessages(db, threadId)).toEqual([]);
    const rows = timelineRows(await fetchTimeline(client, threadId));
    expect(
      rows
        .filter((row) => row.kind === "conversation" && row.role === "user")
        .map((row) => (row.kind === "conversation" ? row.text : "")),
    ).toEqual(["first", "queued"]);
  });

  it("frees a claim the previous process held, so its message is visible again", async () => {
    const { client, db } = await bootThreadHarness({ mode: "manual" });
    const threadId = await createThread(client);
    await client.threads.send({ threadId, text: "first" });
    await client.threads.send({ threadId, text: "queued" });
    const claimed = claimNextQueuedThreadMessage(db, noopNotifier, threadId);
    expect(claimed).not.toBeNull();
    expect(listQueuedThreadMessages(db, threadId)).toEqual([]);

    const revived = new ThreadService({
      db,
      notifier: noopNotifier,
      createTurnDriver: () => unavailableTurnDriver,
    });
    revived.boot();
    expect(revived.get(threadId)?.queuedMessages.map((message) => message.text)).toEqual([
      "queued",
    ]);
    expect(listQueuedThreadMessages(db, threadId).map((row) => row.text)).toEqual(["queued"]);
  });

  it("releases the claim when the thread was archived before the drain could start", async () => {
    const { client, db, driver } = await bootThreadHarness({ mode: "manual" });
    if (!driver) {
      throw new Error("expected the fake driver");
    }
    const threadId = await createThread(client);
    const started = await client.threads.send({
      threadId,
      text: "first",
    });
    if (started.kind !== "started") {
      throw new Error("expected a started turn");
    }
    await client.threads.send({ threadId, text: "queued" });
    await client.threads.archive({ threadId });

    driver.completeTurn(threadId, started.turnId, "completed");
    expect(await getThreadStatus(client, threadId)).toBe("idle");
    expect(listQueuedThreadMessages(db, threadId).map((row) => row.text)).toEqual(["queued"]);
    expect(driver.startedTurns).toHaveLength(1);
  });
});

describe("turn identity and crash recovery", () => {
  it("ignores a late completion for a superseded turn", async () => {
    const { client, driver } = await bootThreadHarness({ mode: "manual" });
    if (!driver) {
      throw new Error("expected the fake driver");
    }
    const threadId = await createThread(client);
    const first = await client.threads.send({ threadId, text: "one" });
    if (first.kind !== "started") {
      throw new Error("expected a started turn");
    }
    driver.completeTurn(threadId, first.turnId, "completed");
    const second = await client.threads.send({ threadId, text: "two" });
    if (second.kind !== "started") {
      throw new Error("expected a second started turn");
    }
    expect(await getThreadStatus(client, threadId)).toBe("active");

    driver.completeTurn(threadId, first.turnId, "completed");
    const detail = await client.threads.get({ threadId });
    expect(detail.thread.status).toBe("active");
    expect(detail.thread.activeTurnId).toBe(second.turnId);
  });

  it("refuses an ingest batch carrying another thread's event, persisting nothing", async () => {
    const { client, db } = await bootThreadHarness({ mode: "manual" });
    const threadId = await createThread(client);
    const other = await createThread(client);
    const service = new ThreadService({
      db,
      notifier: noopNotifier,
      createTurnDriver: () => unavailableTurnDriver,
    });
    expect(() =>
      service.ingestProviderEvents(threadId, [
        { type: "turn/started", threadId: other, scope: { kind: "turn", turnId: "turn_x" } },
      ]),
    ).toThrow(ThreadEventThreadIdMismatchError);
    for (const id of [threadId, other]) {
      const timeline = await fetchTimeline(client, id);
      if (timeline.kind !== "full") {
        throw new Error("expected a full timeline");
      }
      expect(timeline.timeline.maxSequence).toBe(0);
    }
  });

  it("recovers threads a previous process left running", async () => {
    const { client, db } = await bootThreadHarness({ mode: "manual" });
    const threadId = await createThread(client);
    await client.threads.send({ threadId, text: "start" });
    expect(await getThreadStatus(client, threadId)).toBe("active");
    // an approval the dead provider raised and nobody answered.
    const orphan = createPendingInteraction(db, noopNotifier, {
      threadId,
      requestKey: "req-orphaned",
      payload: "{}",
    });

    // a fresh service on the same db is a process restart.
    const revived = new ThreadService({
      db,
      notifier: noopNotifier,
      createTurnDriver: () => unavailableTurnDriver,
    });
    revived.boot();
    expect(revived.get(threadId)?.thread.status).toBe("error");
    expect(await getThreadStatus(client, threadId)).toBe("error");
    const rows = timelineRows(await fetchTimeline(client, threadId));
    const errorRow = rows.find((row) => row.kind === "error");
    if (errorRow?.kind !== "error") {
      throw new Error("expected the synthesized error row");
    }
    expect(errorRow.message).toContain("restarted");

    // turn/completed is the timeline's only writer of a turn's status; provider/error alone leaves the row "working" forever.
    const turnRow = rows.find((row) => row.kind === "turn");
    if (turnRow?.kind !== "turn") {
      throw new Error("expected the orphaned turn's row");
    }
    expect(turnRow.status).toBe("error");

    // the request behind the orphan died with the process, so it settles interrupted rather than answerable.
    expect(getPendingInteraction(db, orphan.id)?.status).toBe("interrupted");
    expect(revived.get(threadId)?.pendingInteractions).toEqual([]);
  });

  it("folds any dispatch throw into error status with a recorded provider/error", async () => {
    const { client, driver } = await bootThreadHarness({ mode: "manual" });
    if (!driver) {
      throw new Error("expected the fake driver");
    }
    const threadId = await createThread(client);
    driver.failNextStart = new Error("adapter exploded");
    const [send] = await safe(client.threads.send({ threadId, text: "hi" }));
    expect(isDefinedError(send) && send.code).toBe("DISPATCH_FAILED");
    expect(await getThreadStatus(client, threadId)).toBe("error");
    const rows = timelineRows(await fetchTimeline(client, threadId));
    const errorRow = rows.find((row) => row.kind === "error");
    if (errorRow?.kind !== "error") {
      throw new Error("expected the recorded dispatch failure");
    }
    expect(errorRow.message).toBe("adapter exploded");
  });
});

describe("thread detail", () => {
  it("thread detail carries the unclaimed queue for pending bubbles", async () => {
    const { client } = await bootThreadHarness({ mode: "manual" });
    const threadId = await createThread(client);
    await client.threads.send({ threadId, text: "start" });
    await client.threads.send({ threadId, text: "bubble me" });
    const detail = await client.threads.get({ threadId });
    expect(detail.queuedMessages.map((message) => message.text)).toEqual(["bubble me"]);
  });
});

describe("pending interactions over the API", () => {
  it("lists open interactions on the thread and answers them exactly once", async () => {
    const { bus, client, db } = await bootThreadHarness({ mode: "manual" });
    const threadId = await createThread(client);
    const payload = {
      kind: "approval",
      subject: {
        kind: "command",
        itemId: "item_1",
        command: "rm -rf node_modules",
        cwd: null,
      },
      reason: null,
      availableDecisions: ["allow_once", "deny"],
    };
    const interaction = createPendingInteraction(db, bus, {
      threadId,
      requestKey: "req-1",
      payload: JSON.stringify(payload),
    });

    const detail = await client.threads.get({ threadId });
    expect(detail.pendingInteractions.map((row) => row.id)).toEqual([interaction.id]);
    expect(detail.pendingInteractions[0]?.payload).toEqual(payload);

    const answered = await client.threads.answerInteraction({
      threadId,
      interactionId: interaction.id,
      resolution: "allow_once",
    });
    expect(answered.interaction.id).toBe(interaction.id);

    const [again] = await safe(
      client.threads.answerInteraction({
        threadId,
        interactionId: interaction.id,
        resolution: "deny",
      }),
    );
    expect(isDefinedError(again) && again.code).toBe("ALREADY_RESOLVED");

    const [unknown] = await safe(
      client.threads.answerInteraction({
        threadId,
        interactionId: "pint_missing",
        resolution: "allow",
      }),
    );
    expect(isDefinedError(unknown) && unknown.code).toBe("NOT_FOUND");
  });
});

describe("a fake-provider turn end-to-end", () => {
  it("streams into a rendered timeline over real HTTP, driven by ws invalidation only", async () => {
    const { client, port } = await listenTestApp(await bootThreadHarness({ mode: "scripted" }));
    const threadId = await createThread(client);

    const socket = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}`, {
      headers: { authorization: authorizationHeader(TEST_SERVER_TOKEN) },
    });
    onTestFinished(() => socket.close());
    const frames: ServerMessage[] = [];
    socket.addEventListener("message", (event) => {
      const text = z.string().safeParse(event.data);
      if (text.success) {
        frames.push(serverMessageLenientSchema.parse(JSON.parse(text.data)));
      }
    });
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", () => reject(new Error("ws error")));
    });
    socket.send(JSON.stringify({ type: "subscribe", target: { kind: "thread-detail", threadId } }));

    // the client acts on ws frames only, never polls; every frame up to the match is consumed so the next wait starts after it.
    async function waitForThreadChange(kind: string): Promise<void> {
      await vi.waitFor(
        () => {
          const index = frames.findIndex(
            (frame) =>
              frame.type === "changed" &&
              frame.entity === "thread" &&
              frame.id === threadId &&
              frame.changes.some((change) => change === kind),
          );
          if (index === -1) throw new Error(`no ${kind} frame yet`);
          frames.splice(0, index + 1);
        },
        { timeout: 5_000, interval: 10 },
      );
    }

    const send = await client.threads.send({
      threadId,
      text: "hello agent",
    });
    expect(send.kind).toBe("started");

    await waitForThreadChange("events-appended");
    await waitForThreadChange("status-changed");

    const full = await fetchTimeline(client, threadId);
    if (full.kind !== "full") {
      throw new Error("expected a full timeline");
    }
    const rows = full.timeline.rows;
    expect(rows.filter((row) => row.kind === "conversation").map((row) => row.text)).toEqual([
      "hello agent",
      "Echo: hello agent",
    ]);
    const turnRow = rows.find((row) => row.kind === "turn");
    if (turnRow?.kind !== "turn") {
      throw new Error("expected a turn row");
    }
    expect(turnRow.status).toBe("completed");
    expect(await getThreadStatus(client, threadId)).toBe("idle");

    const held = full.timeline;
    const secondSend = await client.threads.send({
      threadId,
      text: "and again",
    });
    expect(secondSend.kind).toBe("started");
    await waitForThreadChange("events-appended");

    const delta = await client.threads.timeline({
      threadId,
      afterSequence: held.maxSequence,
    });
    if (delta.kind !== "delta") {
      throw new Error("expected a delta timeline");
    }
    expect(delta.delta.fromSequence).toBe(held.maxSequence);
    const merged = applyTimelineDelta(held, delta.delta);
    const rebuilt = await fetchTimeline(client, threadId);
    if (rebuilt.kind !== "full") {
      throw new Error("expected a full timeline");
    }
    expect(merged).toEqual(rebuilt.timeline);
    expect(
      rebuilt.timeline.rows.filter((row) => row.kind === "conversation").map((row) => row.text),
    ).toEqual(["hello agent", "Echo: hello agent", "and again", "Echo: and again"]);

    const staleDelta = await client.threads.timeline({ threadId, afterSequence: 1 });
    if (staleDelta.kind !== "delta") {
      throw new Error("expected a delta timeline");
    }
    expect(applyTimelineDelta(rebuilt.timeline, staleDelta.delta)).toBeNull();
    const ahead = await client.threads.timeline({
      threadId,
      afterSequence: rebuilt.timeline.maxSequence + 100,
    });
    expect(ahead.kind).toBe("full");
  });
});
