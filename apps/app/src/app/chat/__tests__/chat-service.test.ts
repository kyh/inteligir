// The composer's send flow against the REAL thread service (in-process app,
// typed client): start on idle, steer while running, queue fallback when the
// steer is refused, stale-turn recovery, the whole delegation create, and the
// approval answer the inline card emits.

import { noopNotifier } from "@repo/db/notifier";
import { createPendingInteraction } from "@repo/db/pending-interactions";
import { threadMarkerText } from "@repo/notes/markdown/thread-marker";
import { afterEach, describe, expect, it } from "vitest";
import { createDelegation, ensureChatThread, sendToThread } from "../chat-service";
import { bootChatHarness } from "./chat-harness";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup();
  }
});

describe("sendToThread", () => {
  it("starts a turn on an idle thread", async () => {
    const { client } = await bootChatHarness({ mode: "manual" }, cleanups);
    const thread = await ensureChatThread(client);
    const outcome = await sendToThread(client, {
      threadId: thread.id,
      text: "hello",
      activeTurnId: null,
    });
    expect(outcome.kind).toBe("started");
  });

  it("steers the running turn when the provider accepts", async () => {
    const { client, driver } = await bootChatHarness({ mode: "manual" }, cleanups);
    const thread = await ensureChatThread(client);
    const started = await sendToThread(client, {
      threadId: thread.id,
      text: "first",
      activeTurnId: null,
    });
    if (started.kind !== "started") {
      throw new Error(`expected started, got ${started.kind}`);
    }
    const steered = await sendToThread(client, {
      threadId: thread.id,
      text: "and this",
      activeTurnId: started.turnId,
    });
    expect(steered).toEqual({ kind: "steered", turnId: started.turnId });
    expect(driver.steeredTurns.map((steer) => steer.text)).toEqual(["and this"]);
  });

  it("falls back to the queue when the provider refuses the steer", async () => {
    const { client } = await bootChatHarness({ mode: "manual", steerable: false }, cleanups);
    const thread = await ensureChatThread(client);
    const started = await sendToThread(client, {
      threadId: thread.id,
      text: "first",
      activeTurnId: null,
    });
    if (started.kind !== "started") {
      throw new Error(`expected started, got ${started.kind}`);
    }
    const queued = await sendToThread(client, {
      threadId: thread.id,
      text: "for later",
      activeTurnId: started.turnId,
    });
    expect(queued.kind).toBe("queued");
  });

  it("recovers from a stale expectedTurnId by re-reading the open turn", async () => {
    const { client, driver } = await bootChatHarness({ mode: "manual" }, cleanups);
    const thread = await ensureChatThread(client);
    const first = await sendToThread(client, {
      threadId: thread.id,
      text: "one",
      activeTurnId: null,
    });
    if (first.kind !== "started") {
      throw new Error(`expected started, got ${first.kind}`);
    }
    driver.completeTurn(thread.id, first.turnId, "completed");
    const second = await sendToThread(client, {
      threadId: thread.id,
      text: "two",
      activeTurnId: null,
    });
    if (second.kind !== "started") {
      throw new Error(`expected started, got ${second.kind}`);
    }
    // The client still believes FIRST is running; the retry steers SECOND.
    const recovered = await sendToThread(client, {
      threadId: thread.id,
      text: "stale view",
      activeTurnId: first.turnId,
    });
    expect(recovered).toEqual({ kind: "steered", turnId: second.turnId });
  });

  it("surfaces an archived thread as a refusal", async () => {
    const { client } = await bootChatHarness({ mode: "manual" }, cleanups);
    const thread = await ensureChatThread(client);
    await client.threads.archive.$post({ json: { threadId: thread.id } });
    const outcome = await sendToThread(client, {
      threadId: thread.id,
      text: "hello?",
      activeTurnId: null,
    });
    expect(outcome.kind).toBe("refused");
  });
});

describe("ensureChatThread", () => {
  it("mints the designated thread once and reuses it", async () => {
    const { client } = await bootChatHarness({ mode: "manual" }, cleanups);
    const first = await ensureChatThread(client);
    const second = await ensureChatThread(client);
    expect(second.id).toBe(first.id);
    expect(first.originDocPath).toBeNull();
  });

  it("does not adopt a delegation thread as the chat", async () => {
    const { client } = await bootChatHarness({ mode: "manual" }, cleanups);
    await client.threads.create.$post({
      json: { originDocPath: "Doc.md", originAnchor: "anc_x" },
    });
    const chat = await ensureChatThread(client);
    expect(chat.originDocPath).toBeNull();
  });
});

describe("createDelegation", () => {
  it("creates the bound thread, inserts the anchor, and sends the composed first message", async () => {
    const { client, driver } = await bootChatHarness({ mode: "manual" }, cleanups);
    const inserted: string[] = [];
    const created = await createDelegation(client, {
      intent: "do",
      docPath: "Notes/Plans.md",
      selectionText: "First paragraph.",
      prompt: "Rewrite this",
      insertAnchor: (anchor) => {
        inserted.push(anchor);
        return true;
      },
    });
    expect(created.anchored).toBe(true);
    expect(inserted).toEqual([created.anchor]);
    expect(created.send.kind).toBe("started");

    const detail = await client.threads.get.$get({ query: { threadId: created.threadId } });
    if (!detail.ok) {
      throw new Error("thread detail refused");
    }
    const { thread } = await detail.json();
    expect(thread.originDocPath).toBe("Notes/Plans.md");
    expect(thread.originAnchor).toBe(created.anchor);
    expect(thread.title).toBe("Rewrite this");

    const sent = driver.startedTurns[0]?.text ?? "";
    expect(sent).toContain("Rewrite this");
    expect(sent).toContain("> First paragraph.");
    expect(sent).toContain(threadMarkerText(created.anchor));
    expect(sent).toContain("Notes/Plans.md");
  });

  it("an ask keeps the doc out of the instruction and says so", async () => {
    const { client, driver } = await bootChatHarness({ mode: "manual" }, cleanups);
    await createDelegation(client, {
      intent: "ask",
      docPath: "Notes/Plans.md",
      selectionText: "First paragraph.",
      prompt: "What does this mean?",
      insertAnchor: () => true,
    });
    const sent = driver.startedTurns[0]?.text ?? "";
    expect(sent).toContain("do not modify any files");
    expect(sent).toContain("Question: What does this mean?");
  });

  it("still runs the thread when the buffer is gone, reporting it unanchored", async () => {
    const { client } = await bootChatHarness({ mode: "manual" }, cleanups);
    const created = await createDelegation(client, {
      intent: "do",
      docPath: "Notes/Plans.md",
      selectionText: "First paragraph.",
      prompt: "Rewrite this",
      insertAnchor: () => false,
    });
    expect(created.anchored).toBe(false);
    expect(created.send.kind).toBe("started");
  });
});

describe("the inline approval card's answer", () => {
  it("round-trips the card's decision verb through the answer route", async () => {
    const { client, db } = await bootChatHarness({ mode: "manual" }, cleanups);
    const thread = await ensureChatThread(client);
    // The payload shape the card renders from: only allow_once is offered.
    const interaction = createPendingInteraction(db, noopNotifier, {
      threadId: thread.id,
      requestKey: "req-card",
      payload: JSON.stringify({
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
        availableDecisions: ["allow_once"],
      }),
    });

    const detail = await client.threads.get.$get({ query: { threadId: thread.id } });
    if (!detail.ok) {
      throw new Error("thread detail refused");
    }
    expect((await detail.json()).pendingInteractions.map((row) => row.id)).toEqual([
      interaction.id,
    ]);

    // A decision the card would never render is refused server-side, which is
    // what keeps the card's availableDecisions filter honest rather than
    // decorative.
    const unoffered = await client.threads.interaction.answer.$post({
      json: {
        threadId: thread.id,
        interactionId: interaction.id,
        resolution: "allow_for_session",
      },
    });
    expect(unoffered.status).toBe(400);

    const answered = await client.threads.interaction.answer.$post({
      json: { threadId: thread.id, interactionId: interaction.id, resolution: "allow_once" },
    });
    expect(answered.status).toBe(200);

    // Answered rows leave the open list, so the card stops rendering.
    const after = await client.threads.get.$get({ query: { threadId: thread.id } });
    if (!after.ok) {
      throw new Error("thread detail refused");
    }
    expect((await after.json()).pendingInteractions).toEqual([]);
  });
});
