import { noopNotifier } from "@repo/domain/notifier";
import { createPendingInteraction } from "@repo/db/pending-interactions";
import { isDefinedError, safe } from "@orpc/client";
import { describe, expect, it } from "vitest";
import { sendToThread } from "../send-to-thread";
import { bootThreadHarness } from "inteligir/server/testing";

describe("sendToThread", () => {
  it("starts a turn on an idle thread", async () => {
    const { client } = await bootThreadHarness({ mode: "manual" });
    const { thread } = await client.threads.create({});
    const outcome = await sendToThread(client, {
      activeTurnId: null,
      text: "hello",
      threadId: thread.id,
    });
    expect(outcome.kind).toBe("started");
  });

  it("queues a send into a running turn", async () => {
    const { client } = await bootThreadHarness({ mode: "manual" });
    const { thread } = await client.threads.create({});
    const started = await sendToThread(client, {
      activeTurnId: null,
      text: "first",
      threadId: thread.id,
    });
    if (started.kind !== "started") {
      throw new Error(`expected started, got ${started.kind}`);
    }
    const queued = await sendToThread(client, {
      activeTurnId: started.turnId,
      text: "for later",
      threadId: thread.id,
    });
    expect(queued.kind).toBe("queued");
  });

  it("recovers from a stale expectedTurnId by re-reading the open turn", async () => {
    const { client, driver } = await bootThreadHarness({ mode: "manual" });
    const { thread } = await client.threads.create({});
    const first = await sendToThread(client, {
      activeTurnId: null,
      text: "one",
      threadId: thread.id,
    });
    if (first.kind !== "started") {
      throw new Error(`expected started, got ${first.kind}`);
    }
    driver.completeTurn(thread.id, first.turnId, "completed");
    const second = await sendToThread(client, {
      activeTurnId: null,
      text: "two",
      threadId: thread.id,
    });
    if (second.kind !== "started") {
      throw new Error(`expected started, got ${second.kind}`);
    }
    const recovered = await sendToThread(client, {
      activeTurnId: first.turnId,
      text: "stale view",
      threadId: thread.id,
    });
    expect(recovered.kind).toBe("queued");
    expect(second.turnId).not.toBe(first.turnId);
  });

  it("surfaces an archived thread as a refusal", async () => {
    const { client } = await bootThreadHarness({ mode: "manual" });
    const { thread } = await client.threads.create({});
    await client.threads.archive({ threadId: thread.id });
    const outcome = await sendToThread(client, {
      activeTurnId: null,
      text: "hello?",
      threadId: thread.id,
    });
    expect(outcome.kind).toBe("refused");
  });
});

describe("the view context a composer send carries", () => {
  const VIEW_CONTEXT = {
    resource: "Notes/Plans.md",
    revision: "c".repeat(64),
    surface: "doc",
  } as const;

  it("reaches the provider dispatch through the real send path", async () => {
    const { client, driver } = await bootThreadHarness({ mode: "manual" });
    const { thread } = await client.threads.create({});
    const outcome = await sendToThread(client, {
      activeTurnId: null,
      text: "make this shorter",
      threadId: thread.id,
      viewContext: VIEW_CONTEXT,
    });
    expect(outcome.kind).toBe("started");
    expect(driver.startedTurns[0]?.viewContext).toEqual(VIEW_CONTEXT);
  });

  it("carries none when nothing is open — the palette and the CLI send this shape", async () => {
    const { client, driver } = await bootThreadHarness({ mode: "manual" });
    const { thread } = await client.threads.create({});
    await sendToThread(client, { activeTurnId: null, text: "hello", threadId: thread.id });
    expect(driver.startedTurns[0]?.viewContext).toBeUndefined();
  });

  it("survives the queue as a DROP, not as a stale claim", async () => {
    const { client, driver } = await bootThreadHarness({ mode: "manual" });
    const { thread } = await client.threads.create({});
    const started = await sendToThread(client, {
      activeTurnId: null,
      text: "first",
      threadId: thread.id,
    });
    if (started.kind !== "started") {
      throw new Error(`expected started, got ${started.kind}`);
    }
    const queued = await sendToThread(client, {
      activeTurnId: started.turnId,
      text: "for later",
      threadId: thread.id,
      viewContext: VIEW_CONTEXT,
    });
    expect(queued.kind).toBe("queued");

    driver.completeTurn(thread.id, started.turnId, "completed");
    expect(driver.startedTurns[1]?.text).toBe("for later");
    expect(driver.startedTurns[1]?.viewContext).toBeUndefined();
  });
});

describe("the inline approval card's answer", () => {
  it("round-trips the card's decision verb through the answer route", async () => {
    const { client, db } = await bootThreadHarness({ mode: "manual" });
    const { thread } = await client.threads.create({});
    const interaction = createPendingInteraction(db, noopNotifier, {
      payload: JSON.stringify({
        availableDecisions: ["allow_once"],
        kind: "approval",
        reason: null,
        subject: {
          command: "rm -rf node_modules",
          cwd: null,
          itemId: "item_1",
          kind: "command",
        },
      }),
      requestKey: "req-card",
      threadId: thread.id,
    });

    const detail = await client.threads.get({ threadId: thread.id });
    expect(detail.pendingInteractions.map((row) => row.id)).toEqual([interaction.id]);

    const [unoffered] = await safe(
      client.threads.answerInteraction({
        interactionId: interaction.id,
        resolution: "allow_for_session",
        threadId: thread.id,
      }),
    );
    expect(isDefinedError(unoffered) && unoffered.code).toBe("INVALID_RESOLUTION");

    await client.threads.answerInteraction({
      interactionId: interaction.id,
      resolution: "allow_once",
      threadId: thread.id,
    });

    const after = await client.threads.get({ threadId: thread.id });
    expect(after.pendingInteractions).toEqual([]);
  });
});
