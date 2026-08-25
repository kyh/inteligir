import { serve } from "@hono/node-server";
import { createORPCClient, isDefinedError, ORPCError, safe } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { DbConnection } from "@repo/db/connection";
import { noopNotifier } from "@repo/domain/notifier";
import { createPendingInteraction, getPendingInteraction } from "@repo/db/pending-interactions";
import { listQueuedThreadMessages } from "@repo/db/queued-messages";
import { applyThreadLifecycleEvent } from "@repo/db/threads";
import { serverMessageLenientSchema, type ServerMessage } from "@repo/api/local/notifications";
import { RPC_PREFIX, WS_PATH } from "@repo/api/local/routes";
import type { TimelineResponse } from "@repo/api/local/threads/threads-schema";
import { applyTimelineDelta, type TimelineRow } from "@repo/api/local/thread-timeline";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ThreadEventThreadIdMismatchError, ThreadService } from "../threads/service";
import { unavailableTurnDriver } from "../threads/turn-driver";
import { WsBus } from "../ws-bus";
import { authorizationHeader } from "../server-file";
import { bootTestApp, TEST_SERVER_TOKEN, type BootedTestApp } from "./boot-app";
import { boundAddressSchema } from "./bound-address";
import { FakeTurnDriver, type FakeTurnDriverOptions } from "./fake-turn-driver";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  // LIFO: the ws client must close before the server that holds it.
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup();
  }
});

/** The router's client type, shared by the in-process caller and the one
 *  speaking to a real socket — the same procedures either way. */
type ThreadsClient = BootedTestApp["client"];

interface ThreadsHarness {
  bus: WsBus;
  client: ThreadsClient;
  composed: BootedTestApp["composed"];
  db: DbConnection;
  driver: FakeTurnDriver | null;
}

async function bootThreadsApp(
  driverOptions: FakeTurnDriverOptions | null,
): Promise<ThreadsHarness> {
  // Per-boot closure: two tests boot two harnesses concurrently, so the
  // captured driver must be this call's, never a module-level slot.
  let driver: FakeTurnDriver | null = null;
  const harness = await bootTestApp(
    driverOptions === null
      ? {}
      : {
          makeDriver: () => ({
            createTurnDriver: (sink) => {
              driver = new FakeTurnDriver(sink, driverOptions);
              return driver;
            },
          }),
        },
  );
  return {
    bus: harness.bus,
    client: harness.client,
    composed: harness.composed,
    db: harness.db,
    driver,
  };
}

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

describe("the send-mode matrix", () => {
  it("starts a turn when idle, in either mode", async () => {
    const { client } = await bootThreadsApp({ mode: "manual" });
    const first = await createThread(client);
    const steerStart = await client.threads.send({
      threadId: first,
      text: "hello",
      mode: "steer-if-active",
    });
    expect(steerStart.kind).toBe("started");
    expect(await getThreadStatus(client, first)).toBe("active");

    const second = await createThread(client);
    const queueStart = await client.threads.send({
      threadId: second,
      text: "hello",
      mode: "queue-if-active",
    });
    expect(queueStart.kind).toBe("started");
  });

  it("steers the active turn, guarded by expectedTurnId", async () => {
    const { client, driver } = await bootThreadsApp({ mode: "manual" });
    const threadId = await createThread(client);
    const started = await client.threads.send({
      threadId,
      text: "start",
      mode: "steer-if-active",
    });
    if (started.kind !== "started") {
      throw new Error("expected a started turn");
    }

    const steered = await client.threads.send({
      threadId,
      text: "also this",
      mode: "steer-if-active",
      expectedTurnId: started.turnId,
    });
    expect(steered).toEqual({ kind: "steered", turnId: started.turnId });
    expect(driver?.steeredTurns.map((steer) => steer.text)).toEqual(["also this"]);

    const [stale] = await safe(
      client.threads.send({
        threadId,
        text: "too late",
        mode: "steer-if-active",
        expectedTurnId: "turn_stale",
      }),
    );
    expect(isDefinedError(stale) && stale.code).toBe("STALE_TURN");

    // Both user messages are in the log; the steer never became a new turn.
    const rows = timelineRows(await fetchTimeline(client, threadId));
    expect(rows.filter((row) => row.kind === "conversation").map((row) => row.text)).toEqual([
      "start",
      "also this",
    ]);
  });

  it("refuses a stale expectedTurnId once the turn settled", async () => {
    const { client, driver } = await bootThreadsApp({ mode: "manual" });
    const threadId = await createThread(client);
    const started = await client.threads.send({
      threadId,
      text: "start",
      mode: "steer-if-active",
    });
    if (started.kind !== "started") {
      throw new Error("expected a started turn");
    }
    driver?.completeTurn(threadId, started.turnId, "completed");
    expect(await getThreadStatus(client, threadId)).toBe("idle");

    const [stale] = await safe(
      client.threads.send({
        threadId,
        text: "steer the finished turn",
        mode: "steer-if-active",
        expectedTurnId: started.turnId,
      }),
    );
    expect(isDefinedError(stale) && stale.code).toBe("STALE_TURN");
  });

  it("queues while active, starting and stopping; steering those is refused", async () => {
    const activeHarness = await bootThreadsApp({ mode: "manual" });
    const activeThread = await createThread(activeHarness.client);
    await activeHarness.client.threads.send({
      threadId: activeThread,
      text: "start",
      mode: "steer-if-active",
    });
    const queuedWhileActive = await activeHarness.client.threads.send({
      threadId: activeThread,
      text: "later",
      mode: "queue-if-active",
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
      mode: "queue-if-active",
    });
    expect(queuedWhileStopping.kind).toBe("queued");
    const [steerWhileStopping] = await safe(
      activeHarness.client.threads.send({
        threadId: activeThread,
        text: "nope",
        mode: "steer-if-active",
      }),
    );
    expect(isDefinedError(steerWhileStopping) && steerWhileStopping.code).toBe("NOT_STEERABLE");

    const inertHarness = await bootThreadsApp({ mode: "inert" });
    const startingThread = await createThread(inertHarness.client);
    await inertHarness.client.threads.send({
      threadId: startingThread,
      text: "start",
      mode: "steer-if-active",
    });
    expect(await getThreadStatus(inertHarness.client, startingThread)).toBe("starting");
    const [steerWhileStarting] = await safe(
      inertHarness.client.threads.send({
        threadId: startingThread,
        text: "nope",
        mode: "steer-if-active",
      }),
    );
    expect(isDefinedError(steerWhileStarting) && steerWhileStarting.code).toBe("NOT_STEERABLE");
    const queueWhileStarting = await inertHarness.client.threads.send({
      threadId: startingThread,
      text: "later",
      mode: "queue-if-active",
    });
    expect(queueWhileStarting.kind).toBe("queued");
  });

  it("refuses unknown and archived threads", async () => {
    const { client } = await bootThreadsApp({ mode: "manual" });
    const [missing] = await safe(
      client.threads.send({ threadId: "thr_missing", text: "hi", mode: "steer-if-active" }),
    );
    expect(isDefinedError(missing) && missing.code).toBe("NOT_FOUND");

    const threadId = await createThread(client);
    const archived = await client.threads.archive({ threadId });
    expect(archived.thread.archivedAt).not.toBeNull();
    const [send] = await safe(
      client.threads.send({ threadId, text: "hi", mode: "steer-if-active" }),
    );
    expect(isDefinedError(send) && send.code).toBe("ARCHIVED");
  });

  it("refuses PROVIDER_UNAVAILABLE and lands the thread in error when none is configured", async () => {
    const { client } = await bootThreadsApp(null);
    const threadId = await createThread(client);
    const [send] = await safe(
      client.threads.send({ threadId, text: "hi", mode: "steer-if-active" }),
    );
    expect(isDefinedError(send) && send.code).toBe("PROVIDER_UNAVAILABLE");
    expect(await getThreadStatus(client, threadId)).toBe("error");
  });
});

describe("the view context a message carries", () => {
  const VIEW_CONTEXT = {
    surface: "doc",
    resource: "Notes/Plans.md",
    revision: "a".repeat(64),
    selection: { from: 12, to: 41, text: "First paragraph to delegate." },
  } as const;

  it("reaches the driver, is recorded beside the text, and never becomes the text", async () => {
    const { client, driver } = await bootThreadsApp({ mode: "manual" });
    const threadId = await createThread(client);
    const send = await client.threads.send({
      threadId,
      text: "make this shorter",
      mode: "steer-if-active",
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
    // The bubble is what the user typed, byte for byte; the context is
    // attribution beside it.
    expect(row.text).toBe("make this shorter");
    expect(row.viewContext).toEqual(VIEW_CONTEXT);
  });

  it("rides a steer too — a steer is its own statement about the past", async () => {
    const { client, driver } = await bootThreadsApp({ mode: "manual" });
    const threadId = await createThread(client);
    const started = await client.threads.send({
      threadId,
      text: "start",
      mode: "steer-if-active",
    });
    if (started.kind !== "started") {
      throw new Error("expected a started turn");
    }
    const steered = await client.threads.send({
      threadId,
      text: "and this bit",
      mode: "steer-if-active",
      expectedTurnId: started.turnId,
      viewContext: VIEW_CONTEXT,
    });
    expect(steered.kind).toBe("steered");
    expect(driver?.steeredTurns[0]?.viewContext).toEqual(VIEW_CONTEXT);
  });

  it("is DROPPED by a queued send, which drains onto a screen the user has left", async () => {
    const { client, driver } = await bootThreadsApp({ mode: "manual" });
    if (!driver) {
      throw new Error("expected the fake driver");
    }
    const threadId = await createThread(client);
    const started = await client.threads.send({
      threadId,
      text: "first",
      mode: "steer-if-active",
    });
    if (started.kind !== "started") {
      throw new Error("expected a started turn");
    }
    const queued = await client.threads.send({
      threadId,
      text: "for later",
      mode: "queue-if-active",
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
    const { client } = await bootThreadsApp({ mode: "manual" });
    const threadId = await createThread(client);
    const [error] = await safe(
      client.threads.send({
        threadId,
        text: "hi",
        mode: "steer-if-active",
        viewContext: { ...VIEW_CONTEXT, resource: "../outside.md" },
      }),
    );
    // The path grammar rides the input schema, so its refusal is oRPC's own
    // validation class rather than one this domain declares.
    expect(error instanceof ORPCError && error.code).toBe("BAD_REQUEST");
  });
});

describe("the queue drain", () => {
  it("drains queued messages one turn at a time as the thread settles idle", async () => {
    const { client, db, driver } = await bootThreadsApp({ mode: "manual" });
    if (!driver) {
      throw new Error("expected the fake driver");
    }
    const threadId = await createThread(client);
    const started = await client.threads.send({
      threadId,
      text: "first",
      mode: "steer-if-active",
    });
    if (started.kind !== "started") {
      throw new Error("expected a started turn");
    }
    for (const text of ["q1", "q2"]) {
      const queued = await client.threads.send({ threadId, text, mode: "queue-if-active" });
      expect(queued.kind).toBe("queued");
    }
    expect(listQueuedThreadMessages(db, threadId)).toHaveLength(2);

    driver.completeTurn(threadId, started.turnId, "completed");
    // The drain started q1's turn, so the thread is active again, not idle.
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

  it("releases the claim instead of consuming the message when dispatch fails", async () => {
    const { client, db, driver } = await bootThreadsApp({ mode: "manual" });
    if (!driver) {
      throw new Error("expected the fake driver");
    }
    const threadId = await createThread(client);
    const started = await client.threads.send({
      threadId,
      text: "first",
      mode: "steer-if-active",
    });
    if (started.kind !== "started") {
      throw new Error("expected a started turn");
    }
    await client.threads.send({ threadId, text: "queued", mode: "queue-if-active" });

    driver.failNextStart = new Error("boom");
    driver.completeTurn(threadId, started.turnId, "completed");
    // The drain claimed, dispatch blew up: thread errored, message survives.
    expect(await getThreadStatus(client, threadId)).toBe("error");
    expect(listQueuedThreadMessages(db, threadId).map((row) => row.text)).toEqual(["queued"]);
  });

  it("releases the claim when the thread was archived before the drain could start", async () => {
    const { client, db, driver } = await bootThreadsApp({ mode: "manual" });
    if (!driver) {
      throw new Error("expected the fake driver");
    }
    const threadId = await createThread(client);
    const started = await client.threads.send({
      threadId,
      text: "first",
      mode: "steer-if-active",
    });
    if (started.kind !== "started") {
      throw new Error("expected a started turn");
    }
    await client.threads.send({ threadId, text: "queued", mode: "queue-if-active" });
    await client.threads.archive({ threadId });

    driver.completeTurn(threadId, started.turnId, "completed");
    // The settle still lands (archives never wedge a run), but the drain's
    // run.preparing is superseded — the message is released, not consumed.
    expect(await getThreadStatus(client, threadId)).toBe("idle");
    expect(listQueuedThreadMessages(db, threadId).map((row) => row.text)).toEqual(["queued"]);
    expect(driver.startedTurns).toHaveLength(1);
  });
});

describe("turn identity and crash recovery", () => {
  it("ignores a late completion for a superseded turn", async () => {
    const { client, driver } = await bootThreadsApp({ mode: "manual" });
    if (!driver) {
      throw new Error("expected the fake driver");
    }
    const threadId = await createThread(client);
    const first = await client.threads.send({ threadId, text: "one", mode: "steer-if-active" });
    if (first.kind !== "started") {
      throw new Error("expected a started turn");
    }
    driver.completeTurn(threadId, first.turnId, "completed");
    const second = await client.threads.send({ threadId, text: "two", mode: "steer-if-active" });
    if (second.kind !== "started") {
      throw new Error("expected a second started turn");
    }
    expect(await getThreadStatus(client, threadId)).toBe("active");

    // The duplicate settle for the FIRST turn must not settle the second.
    driver.completeTurn(threadId, first.turnId, "completed");
    const detail = await client.threads.get({ threadId });
    expect(detail.thread.status).toBe("active");
    expect(detail.thread.activeTurnId).toBe(second.turnId);
  });

  it("refuses an ingest batch carrying another thread's event, persisting nothing", async () => {
    const { client, db } = await bootThreadsApp({ mode: "manual" });
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
    const { client, db } = await bootThreadsApp({ mode: "manual" });
    const threadId = await createThread(client);
    await client.threads.send({ threadId, text: "start", mode: "steer-if-active" });
    expect(await getThreadStatus(client, threadId)).toBe("active");
    // An approval the dead provider raised and nobody answered.
    const orphan = createPendingInteraction(db, noopNotifier, {
      threadId,
      requestKey: "req-orphaned",
      payload: "{}",
    });

    // A fresh service on the same db is a process restart: no driver claim
    // is live, so the running thread is an orphan and settles to error.
    const revived = new ThreadService({
      db,
      notifier: noopNotifier,
      createTurnDriver: () => unavailableTurnDriver,
    });
    expect(revived.get(threadId)?.thread.status).toBe("error");
    expect(await getThreadStatus(client, threadId)).toBe("error");
    const rows = timelineRows(await fetchTimeline(client, threadId));
    const errorRow = rows.find((row) => row.kind === "error");
    if (errorRow?.kind !== "error") {
      throw new Error("expected the synthesized error row");
    }
    expect(errorRow.message).toContain("restarted");

    // The provider request behind the orphan died with the process: the row
    // settles as interrupted, never left answerable. A restarted provider
    // raises a fresh row (new request key) instead of a duplicate.
    expect(getPendingInteraction(db, orphan.id)?.status).toBe("interrupted");
    expect(revived.get(threadId)?.pendingInteractions).toEqual([]);
  });

  it("folds any dispatch throw into error status with a recorded provider/error", async () => {
    const { client, driver } = await bootThreadsApp({ mode: "manual" });
    if (!driver) {
      throw new Error("expected the fake driver");
    }
    const threadId = await createThread(client);
    driver.failNextStart = new Error("adapter exploded");
    const [send] = await safe(
      client.threads.send({ threadId, text: "hi", mode: "steer-if-active" }),
    );
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

describe("the by-doc query", () => {
  it("answers exactly the threads bound to the doc, archived included, with activity counts", async () => {
    const { bus, client, db, driver } = await bootThreadsApp({ mode: "manual" });
    if (!driver) {
      throw new Error("expected the fake driver");
    }
    const plainChat = await createThread(client);
    void plainChat;
    const { thread: bound } = await client.threads.create({
      title: "Fix the intro",
      originDocPath: "Notes/Plans.md",
      originAnchor: "anc_00000000000a",
    });
    await client.threads.create({
      originDocPath: "Other.md",
      originAnchor: "anc_00000000000b",
    });

    // Activity the counts must surface: a running turn with a queued send
    // and an open approval.
    const started = await client.threads.send({
      threadId: bound.id,
      text: "go",
      mode: "steer-if-active",
    });
    expect(started.kind).toBe("started");
    await client.threads.send({ threadId: bound.id, text: "later", mode: "queue-if-active" });
    createPendingInteraction(db, bus, {
      threadId: bound.id,
      requestKey: "req-chip",
      payload: JSON.stringify({ kind: "approval" }),
    });

    const byDoc = await client.threads.byDoc({ docPath: "Notes/Plans.md" });
    expect(byDoc.threads).toHaveLength(1);
    const activity = byDoc.threads[0];
    expect(activity?.thread.id).toBe(bound.id);
    expect(activity?.thread.originAnchor).toBe("anc_00000000000a");
    expect(activity?.openInteractionCount).toBe(1);
    expect(activity?.queuedCount).toBe(1);

    // Archiving keeps the row in the answer — the chip's dismiss affordance
    // is keyed off exactly this.
    await client.threads.archive({ threadId: bound.id });
    const afterArchive = await client.threads.byDoc({ docPath: "Notes/Plans.md" });
    expect(afterArchive.threads[0]?.thread.archivedAt).not.toBeNull();
  });

  it("thread detail carries the unclaimed queue for pending bubbles", async () => {
    const { client } = await bootThreadsApp({ mode: "manual" });
    const threadId = await createThread(client);
    await client.threads.send({ threadId, text: "start", mode: "steer-if-active" });
    await client.threads.send({ threadId, text: "bubble me", mode: "queue-if-active" });
    const detail = await client.threads.get({ threadId });
    expect(detail.queuedMessages.map((message) => message.text)).toEqual(["bubble me"]);
  });
});

describe("pending interactions over the API", () => {
  it("lists open interactions on the thread and answers them exactly once", async () => {
    const { bus, client, db } = await bootThreadsApp({ mode: "manual" });
    const threadId = await createThread(client);
    const payload = {
      kind: "approval",
      subject: {
        kind: "command",
        itemId: "item_1",
        command: "rm -rf node_modules",
        cwd: null,
        actions: [],
        sessionGrant: null,
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
    const { composed } = await bootThreadsApp({ mode: "scripted" });

    const server = serve({ fetch: composed.app.fetch, hostname: "127.0.0.1", port: 0 });
    composed.injectWebSocket(server);
    cleanups.push(
      () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
    );
    if (server.address() === null) {
      await new Promise<void>((resolve) => server.once("listening", resolve));
    }
    const address = boundAddressSchema.parse(server.address());
    const client: ThreadsClient = createORPCClient(
      new RPCLink({
        origin: `http://127.0.0.1:${address.port}`,
        url: RPC_PREFIX,
        headers: { authorization: authorizationHeader(TEST_SERVER_TOKEN) },
      }),
    );
    const threadId = await createThread(client);

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}${WS_PATH}`, {
      headers: { authorization: authorizationHeader(TEST_SERVER_TOKEN) },
    });
    cleanups.push(() => socket.close());
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

    // The invalidation contract: the client acts on ws frames only — it never
    // polls the API on a timer. Waiting for a specific change kind before
    // each fetch is exactly what the workspace UI (#552) will do.
    async function waitForThreadChange(kind: string): Promise<void> {
      const deadline = Date.now() + 5_000;
      for (;;) {
        while (frames.length > 0) {
          const frame = frames.shift();
          if (frame === undefined) continue;
          if (
            frame.type === "changed" &&
            frame.entity === "thread" &&
            frame.id === threadId &&
            frame.changes.some((change) => change === kind)
          ) {
            return;
          }
        }
        if (Date.now() > deadline) {
          throw new Error(`timed out waiting for a ${kind} frame`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    const send = await client.threads.send({
      threadId,
      text: "hello agent",
      mode: "steer-if-active",
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

    // Second turn: the client holds its rows and maxSequence, learns of new
    // events from the socket, and catches up with one delta fetch.
    const held = full.timeline;
    const secondSend = await client.threads.send({
      threadId,
      text: "and again",
      mode: "steer-if-active",
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

    // A delta against a base the client does NOT hold is refused client-side
    // and answered full server-side when the base is ahead of the log.
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
