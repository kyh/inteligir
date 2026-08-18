import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createConnection, type DbConnection } from "@repo/db/connection";
import { runMigrations } from "@repo/db/migrate";
import { noopNotifier } from "@repo/domain/notifier";
import { createPendingInteraction, getPendingInteraction } from "@repo/db/pending-interactions";
import { listQueuedThreadMessages } from "@repo/db/queued-messages";
import { applyThreadLifecycleEvent } from "@repo/db/threads";
import { createApiClient, type ApiClient } from "@repo/server-contract/client";
import { serverMessageLenientSchema } from "@repo/server-contract/notifications";
import { apiErrorResponseSchema } from "@repo/server-contract/errors";
import {
  pendingInteractionSchema,
  threadSchema,
  timelineResponseSchema,
  type TimelineResponse,
} from "@repo/server-contract/threads";
import { applyTimelineDelta, type TimelineRow } from "@repo/server-contract/thread-timeline";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp, type CreateAppArgs } from "../app";
import { createKnowledgeRuntime } from "../knowledge/knowledge-runtime";
import { ThreadEventThreadIdMismatchError, ThreadService } from "../threads/service";
import { unavailableTurnDriver, type CreateTurnDriver } from "../threads/turn-driver";
import { hermeticGitEnv } from "../vault/__tests__/git-test-env";
import { createVaultRuntime } from "../vault/vault-runtime";
import { WsBus } from "../ws-bus";
import { FakeTurnDriver, type FakeTurnDriverOptions } from "./fake-turn-driver";
import { makeTempDir } from "./temp-dir";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  // LIFO: the ws client must close before the server that holds it.
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup();
  }
});

const sendResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("started"), turnId: z.string().min(1) }),
  z.object({ kind: z.literal("steered"), turnId: z.string().min(1) }),
  z.object({ kind: z.literal("queued"), queuedMessageId: z.string().min(1) }),
]);

const threadEnvelopeSchema = z.object({ thread: threadSchema });
const threadDetailSchema = z.object({
  thread: threadSchema,
  pendingInteractions: z.array(pendingInteractionSchema),
});

interface ThreadsHarness {
  bus: WsBus;
  client: ApiClient;
  composed: ReturnType<typeof createApp>;
  db: DbConnection;
  driver: FakeTurnDriver | null;
}

async function bootThreadsApp(
  driverOptions: FakeTurnDriverOptions | null,
): Promise<ThreadsHarness> {
  const instanceDir = makeTempDir("inteligir-threads-test-");
  const dataDir = join(instanceDir, "data");
  const vaultDir = join(instanceDir, "vault");
  mkdirSync(dataDir, { recursive: true });
  const databasePath = join(dataDir, "inteligir.db");
  const db = createConnection(databasePath);
  runMigrations(db);

  let driver: FakeTurnDriver | null = null;
  const createTurnDriver: CreateTurnDriver =
    driverOptions === null
      ? () => unavailableTurnDriver
      : (sink) => {
          driver = new FakeTurnDriver(sink, driverOptions);
          return driver;
        };

  const bus = new WsBus({ version: "0.1.0-test" });
  const vault = await createVaultRuntime({
    vaultDir,
    vaultRemote: null,
    dataDir,
    notifier: bus,
    watch: false,
    syncIntervalMs: null,
    gitEnv: hermeticGitEnv(),
  });
  cleanups.push(() => vault.dispose());
  const knowledge = createKnowledgeRuntime({
    dataDir,
    vault: vault.service,
    vaultRoot: vaultDir,
  });
  cleanups.push(() => knowledge.dispose());
  const args: CreateAppArgs = {
    agent: { mode: "off", runtime: "off", detail: null },
    bus,
    config: {
      databasePath,
      dataDir,
      dataDirSource: "env",
      devHmrPort: 0,
      mode: "dev",
      port: 0,
      portSource: "env",
      vaultDir,
      vaultRemote: null,
      agent: "off",
      agentModel: null,
    },
    createTurnDriver,
    db,
    fallback: { kind: "none" },
    instanceSecret: "test-instance-secret",
    knowledge,
    schemaVersion: 2,
    startedAt: Date.now(),
    vault,
    version: "0.1.0-test",
  };
  const composed = createApp(args);
  const client = createApiClient("http://threads.test", {
    fetch: async (input, init) => composed.app.request(input, init),
  });
  return { bus, client, composed, db, driver };
}

async function createThread(client: ApiClient): Promise<string> {
  const response = await client.threads.create.$post({ json: {} });
  expect(response.status).toBe(201);
  return threadEnvelopeSchema.parse(await response.json()).thread.id;
}

async function getThreadStatus(client: ApiClient, threadId: string): Promise<string> {
  const response = await client.threads.get.$get({ query: { threadId } });
  expect(response.status).toBe(200);
  return threadDetailSchema.parse(await response.json()).thread.status;
}

async function fetchTimeline(client: ApiClient, threadId: string): Promise<TimelineResponse> {
  const response = await client.threads.timeline.$get({ query: { threadId } });
  expect(response.status).toBe(200);
  return timelineResponseSchema.parse(await response.json());
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
    const steerStart = await client.threads.send.$post({
      json: { threadId: first, text: "hello", mode: "steer-if-active" },
    });
    expect(steerStart.status).toBe(200);
    expect(sendResponseSchema.parse(await steerStart.json()).kind).toBe("started");
    expect(await getThreadStatus(client, first)).toBe("active");

    const second = await createThread(client);
    const queueStart = await client.threads.send.$post({
      json: { threadId: second, text: "hello", mode: "queue-if-active" },
    });
    expect(sendResponseSchema.parse(await queueStart.json()).kind).toBe("started");
  });

  it("steers the active turn, guarded by expectedTurnId", async () => {
    const { client, driver } = await bootThreadsApp({ mode: "manual" });
    const threadId = await createThread(client);
    const started = sendResponseSchema.parse(
      await (
        await client.threads.send.$post({
          json: { threadId, text: "start", mode: "steer-if-active" },
        })
      ).json(),
    );
    if (started.kind !== "started") {
      throw new Error("expected a started turn");
    }

    const steered = await client.threads.send.$post({
      json: {
        threadId,
        text: "also this",
        mode: "steer-if-active",
        expectedTurnId: started.turnId,
      },
    });
    expect(steered.status).toBe(200);
    const steeredBody = sendResponseSchema.parse(await steered.json());
    expect(steeredBody).toEqual({ kind: "steered", turnId: started.turnId });
    expect(driver?.steeredTurns.map((steer) => steer.text)).toEqual(["also this"]);

    const stale = await client.threads.send.$post({
      json: {
        threadId,
        text: "too late",
        mode: "steer-if-active",
        expectedTurnId: "turn_stale",
      },
    });
    expect(stale.status).toBe(409);
    expect(apiErrorResponseSchema.parse(await stale.json()).error).toBe("stale_turn");

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
    const started = sendResponseSchema.parse(
      await (
        await client.threads.send.$post({
          json: { threadId, text: "start", mode: "steer-if-active" },
        })
      ).json(),
    );
    if (started.kind !== "started") {
      throw new Error("expected a started turn");
    }
    driver?.completeTurn(threadId, started.turnId, "completed");
    expect(await getThreadStatus(client, threadId)).toBe("idle");

    const stale = await client.threads.send.$post({
      json: {
        threadId,
        text: "steer the finished turn",
        mode: "steer-if-active",
        expectedTurnId: started.turnId,
      },
    });
    expect(stale.status).toBe(409);
    expect(apiErrorResponseSchema.parse(await stale.json()).error).toBe("stale_turn");
  });

  it("queues while active, starting and stopping; steering those is a 409", async () => {
    const activeHarness = await bootThreadsApp({ mode: "manual" });
    const activeThread = await createThread(activeHarness.client);
    await activeHarness.client.threads.send.$post({
      json: { threadId: activeThread, text: "start", mode: "steer-if-active" },
    });
    const queuedWhileActive = await activeHarness.client.threads.send.$post({
      json: { threadId: activeThread, text: "later", mode: "queue-if-active" },
    });
    expect(sendResponseSchema.parse(await queuedWhileActive.json()).kind).toBe("queued");

    applyThreadLifecycleEvent(activeHarness.db, noopNotifier, {
      threadId: activeThread,
      event: { type: "stop.requested" },
    });
    expect(await getThreadStatus(activeHarness.client, activeThread)).toBe("stopping");
    const queuedWhileStopping = await activeHarness.client.threads.send.$post({
      json: { threadId: activeThread, text: "after the stop", mode: "queue-if-active" },
    });
    expect(sendResponseSchema.parse(await queuedWhileStopping.json()).kind).toBe("queued");
    const steerWhileStopping = await activeHarness.client.threads.send.$post({
      json: { threadId: activeThread, text: "nope", mode: "steer-if-active" },
    });
    expect(steerWhileStopping.status).toBe(409);
    expect(apiErrorResponseSchema.parse(await steerWhileStopping.json()).error).toBe(
      "not_steerable",
    );

    const inertHarness = await bootThreadsApp({ mode: "inert" });
    const startingThread = await createThread(inertHarness.client);
    await inertHarness.client.threads.send.$post({
      json: { threadId: startingThread, text: "start", mode: "steer-if-active" },
    });
    expect(await getThreadStatus(inertHarness.client, startingThread)).toBe("starting");
    const steerWhileStarting = await inertHarness.client.threads.send.$post({
      json: { threadId: startingThread, text: "nope", mode: "steer-if-active" },
    });
    expect(steerWhileStarting.status).toBe(409);
    const queueWhileStarting = await inertHarness.client.threads.send.$post({
      json: { threadId: startingThread, text: "later", mode: "queue-if-active" },
    });
    expect(sendResponseSchema.parse(await queueWhileStarting.json()).kind).toBe("queued");
  });

  it("refuses unknown and archived threads", async () => {
    const { client } = await bootThreadsApp({ mode: "manual" });
    const missing = await client.threads.send.$post({
      json: { threadId: "thr_missing", text: "hi", mode: "steer-if-active" },
    });
    expect(missing.status).toBe(404);

    const threadId = await createThread(client);
    const archived = await client.threads.archive.$post({ json: { threadId } });
    expect(archived.status).toBe(200);
    const send = await client.threads.send.$post({
      json: { threadId, text: "hi", mode: "steer-if-active" },
    });
    expect(send.status).toBe(409);
    expect(apiErrorResponseSchema.parse(await send.json()).error).toBe("archived");
  });

  it("answers 503 and lands the thread in error when no provider is configured", async () => {
    const { client } = await bootThreadsApp(null);
    const threadId = await createThread(client);
    const send = await client.threads.send.$post({
      json: { threadId, text: "hi", mode: "steer-if-active" },
    });
    expect(send.status).toBe(503);
    expect(apiErrorResponseSchema.parse(await send.json()).error).toBe("provider_unavailable");
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
    const send = await client.threads.send.$post({
      json: {
        threadId,
        text: "make this shorter",
        mode: "steer-if-active",
        viewContext: VIEW_CONTEXT,
      },
    });
    expect(send.status).toBe(200);
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
    const started = sendResponseSchema.parse(
      await (
        await client.threads.send.$post({
          json: { threadId, text: "start", mode: "steer-if-active" },
        })
      ).json(),
    );
    if (started.kind !== "started") {
      throw new Error("expected a started turn");
    }
    const steered = await client.threads.send.$post({
      json: {
        threadId,
        text: "and this bit",
        mode: "steer-if-active",
        expectedTurnId: started.turnId,
        viewContext: VIEW_CONTEXT,
      },
    });
    expect(steered.status).toBe(200);
    expect(driver?.steeredTurns[0]?.viewContext).toEqual(VIEW_CONTEXT);
  });

  it("is DROPPED by a queued send, which drains onto a screen the user has left", async () => {
    const { client, driver } = await bootThreadsApp({ mode: "manual" });
    if (!driver) {
      throw new Error("expected the fake driver");
    }
    const threadId = await createThread(client);
    const started = sendResponseSchema.parse(
      await (
        await client.threads.send.$post({
          json: { threadId, text: "first", mode: "steer-if-active" },
        })
      ).json(),
    );
    if (started.kind !== "started") {
      throw new Error("expected a started turn");
    }
    const queued = await client.threads.send.$post({
      json: { threadId, text: "for later", mode: "queue-if-active", viewContext: VIEW_CONTEXT },
    });
    expect(sendResponseSchema.parse(await queued.json()).kind).toBe("queued");

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
    const send = await client.threads.send.$post({
      json: {
        threadId,
        text: "hi",
        mode: "steer-if-active",
        viewContext: { ...VIEW_CONTEXT, resource: "../outside.md" },
      },
    });
    expect(send.status).toBe(400);
  });
});

describe("the queue drain", () => {
  it("drains queued messages one turn at a time as the thread settles idle", async () => {
    const { client, db, driver } = await bootThreadsApp({ mode: "manual" });
    if (!driver) {
      throw new Error("expected the fake driver");
    }
    const threadId = await createThread(client);
    const started = sendResponseSchema.parse(
      await (
        await client.threads.send.$post({
          json: { threadId, text: "first", mode: "steer-if-active" },
        })
      ).json(),
    );
    if (started.kind !== "started") {
      throw new Error("expected a started turn");
    }
    for (const text of ["q1", "q2"]) {
      const queued = await client.threads.send.$post({
        json: { threadId, text, mode: "queue-if-active" },
      });
      expect(sendResponseSchema.parse(await queued.json()).kind).toBe("queued");
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
    const started = sendResponseSchema.parse(
      await (
        await client.threads.send.$post({
          json: { threadId, text: "first", mode: "steer-if-active" },
        })
      ).json(),
    );
    if (started.kind !== "started") {
      throw new Error("expected a started turn");
    }
    await client.threads.send.$post({
      json: { threadId, text: "queued", mode: "queue-if-active" },
    });

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
    const started = sendResponseSchema.parse(
      await (
        await client.threads.send.$post({
          json: { threadId, text: "first", mode: "steer-if-active" },
        })
      ).json(),
    );
    if (started.kind !== "started") {
      throw new Error("expected a started turn");
    }
    await client.threads.send.$post({
      json: { threadId, text: "queued", mode: "queue-if-active" },
    });
    await client.threads.archive.$post({ json: { threadId } });

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
    const first = sendResponseSchema.parse(
      await (
        await client.threads.send.$post({
          json: { threadId, text: "one", mode: "steer-if-active" },
        })
      ).json(),
    );
    if (first.kind !== "started") {
      throw new Error("expected a started turn");
    }
    driver.completeTurn(threadId, first.turnId, "completed");
    const second = sendResponseSchema.parse(
      await (
        await client.threads.send.$post({
          json: { threadId, text: "two", mode: "steer-if-active" },
        })
      ).json(),
    );
    if (second.kind !== "started") {
      throw new Error("expected a second started turn");
    }
    expect(await getThreadStatus(client, threadId)).toBe("active");

    // The duplicate settle for the FIRST turn must not settle the second.
    driver.completeTurn(threadId, first.turnId, "completed");
    const detail = threadDetailSchema.parse(
      await (await client.threads.get.$get({ query: { threadId } })).json(),
    );
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
    await client.threads.send.$post({
      json: { threadId, text: "start", mode: "steer-if-active" },
    });
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
    const send = await client.threads.send.$post({
      json: { threadId, text: "hi", mode: "steer-if-active" },
    });
    expect(send.status).toBe(503);
    expect(apiErrorResponseSchema.parse(await send.json()).error).toBe("dispatch_failed");
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
    const boundResponse = await client.threads.create.$post({
      json: {
        title: "Fix the intro",
        originDocPath: "Notes/Plans.md",
        originAnchor: "anc_00000000000a",
      },
    });
    expect(boundResponse.status).toBe(201);
    const bound = threadEnvelopeSchema.parse(await boundResponse.json()).thread;
    const otherDocResponse = await client.threads.create.$post({
      json: { originDocPath: "Other.md", originAnchor: "anc_00000000000b" },
    });
    expect(otherDocResponse.status).toBe(201);

    // Activity the counts must surface: a running turn with a queued send
    // and an open approval.
    const started = sendResponseSchema.parse(
      await (
        await client.threads.send.$post({
          json: { threadId: bound.id, text: "go", mode: "steer-if-active" },
        })
      ).json(),
    );
    expect(started.kind).toBe("started");
    await client.threads.send.$post({
      json: { threadId: bound.id, text: "later", mode: "queue-if-active" },
    });
    createPendingInteraction(db, bus, {
      threadId: bound.id,
      requestKey: "req-chip",
      payload: JSON.stringify({ kind: "approval" }),
    });

    const byDoc = await client.threads["by-doc"].$get({
      query: { docPath: "Notes/Plans.md" },
    });
    expect(byDoc.status).toBe(200);
    const body = z
      .object({
        threads: z.array(
          z.object({
            thread: threadSchema,
            openInteractionCount: z.number().int(),
            queuedCount: z.number().int(),
          }),
        ),
      })
      .parse(await byDoc.json());
    expect(body.threads).toHaveLength(1);
    const activity = body.threads[0];
    expect(activity?.thread.id).toBe(bound.id);
    expect(activity?.thread.originAnchor).toBe("anc_00000000000a");
    expect(activity?.openInteractionCount).toBe(1);
    expect(activity?.queuedCount).toBe(1);

    // Archiving keeps the row in the answer — the chip's dismiss affordance
    // is keyed off exactly this.
    await client.threads.archive.$post({ json: { threadId: bound.id } });
    const afterArchive = await client.threads["by-doc"].$get({
      query: { docPath: "Notes/Plans.md" },
    });
    const archivedBody = z
      .object({ threads: z.array(z.object({ thread: threadSchema })) })
      .loose()
      .parse(await afterArchive.json());
    expect(archivedBody.threads[0]?.thread.archivedAt).not.toBeNull();
  });

  it("thread detail carries the unclaimed queue for pending bubbles", async () => {
    const { client } = await bootThreadsApp({ mode: "manual" });
    const threadId = await createThread(client);
    await client.threads.send.$post({
      json: { threadId, text: "start", mode: "steer-if-active" },
    });
    await client.threads.send.$post({
      json: { threadId, text: "bubble me", mode: "queue-if-active" },
    });
    const detail = await client.threads.get.$get({ query: { threadId } });
    const body = z
      .object({
        thread: threadSchema,
        pendingInteractions: z.array(pendingInteractionSchema),
        queuedMessages: z.array(
          z.object({ id: z.string().min(1), text: z.string(), createdAt: z.number() }),
        ),
      })
      .parse(await detail.json());
    expect(body.queuedMessages.map((message) => message.text)).toEqual(["bubble me"]);
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

    const detailResponse = await client.threads.get.$get({ query: { threadId } });
    const detail = threadDetailSchema.parse(await detailResponse.json());
    expect(detail.pendingInteractions.map((row) => row.id)).toEqual([interaction.id]);
    expect(detail.pendingInteractions[0]?.payload).toEqual(payload);

    const answered = await client.threads.interaction.answer.$post({
      json: { threadId, interactionId: interaction.id, resolution: "allow_once" },
    });
    expect(answered.status).toBe(200);

    const again = await client.threads.interaction.answer.$post({
      json: { threadId, interactionId: interaction.id, resolution: "deny" },
    });
    expect(again.status).toBe(409);

    const unknown = await client.threads.interaction.answer.$post({
      json: { threadId, interactionId: "pint_missing", resolution: "allow" },
    });
    expect(unknown.status).toBe(404);
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
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected a bound AddressInfo");
    }
    const client = createApiClient(`http://127.0.0.1:${address.port}`);
    const threadId = await createThread(client);

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    cleanups.push(() => socket.close());
    const frames: unknown[] = [];
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        frames.push(JSON.parse(event.data));
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
          const frame = serverMessageLenientSchema.parse(frames.shift());
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

    const send = await client.threads.send.$post({
      json: { threadId, text: "hello agent", mode: "steer-if-active" },
    });
    expect(send.status).toBe(200);
    expect(sendResponseSchema.parse(await send.json()).kind).toBe("started");

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
    const secondSend = await client.threads.send.$post({
      json: { threadId, text: "and again", mode: "steer-if-active" },
    });
    expect(secondSend.status).toBe(200);
    await waitForThreadChange("events-appended");

    const deltaResponse = await client.threads.timeline.$get({
      query: { threadId, afterSequence: held.maxSequence },
    });
    expect(deltaResponse.status).toBe(200);
    const delta = timelineResponseSchema.parse(await deltaResponse.json());
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
    const staleDeltaResponse = await client.threads.timeline.$get({
      query: { threadId, afterSequence: 1 },
    });
    const staleDelta = timelineResponseSchema.parse(await staleDeltaResponse.json());
    if (staleDelta.kind !== "delta") {
      throw new Error("expected a delta timeline");
    }
    expect(applyTimelineDelta(rebuilt.timeline, staleDelta.delta)).toBeNull();
    const aheadResponse = await client.threads.timeline.$get({
      query: { threadId, afterSequence: rebuilt.timeline.maxSequence + 100 },
    });
    expect(timelineResponseSchema.parse(await aheadResponse.json()).kind).toBe("full");
  });
});
