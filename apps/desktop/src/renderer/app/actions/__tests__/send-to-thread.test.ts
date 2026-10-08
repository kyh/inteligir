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
