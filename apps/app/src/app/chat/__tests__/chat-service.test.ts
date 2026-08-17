// The composer's send flow against the REAL thread service (in-process app,
// typed client): the send-mode matrix including the unguarded-steer refusal,
// the single-flight chat resolver, the delegation create's ordering, and the
// approval answer the inline card emits.

import { noopNotifier } from "@repo/domain/notifier";
import { createPendingInteraction } from "@repo/db/pending-interactions";
import { threadMarkerText } from "@repo/notes/markdown/thread-marker";
import { describe, expect, it } from "vitest";
import { createChatThreadResolver, createDelegation, sendToThread } from "../chat-service";
import { bootChatHarness } from "./chat-harness";

describe("sendToThread", () => {
  it("starts a turn on an idle thread", async () => {
    const { client } = await bootChatHarness({ mode: "manual" });
    const thread = await createChatThreadResolver(client)();
    const outcome = await sendToThread(client, {
      threadId: thread.id,
      text: "hello",
      activeTurnId: null,
    });
    expect(outcome.kind).toBe("started");
  });

  it("steers the running turn when the provider accepts", async () => {
    const { client, driver } = await bootChatHarness({ mode: "manual" });
    const thread = await createChatThreadResolver(client)();
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
    const { client } = await bootChatHarness({ mode: "manual", steerable: false });
    const thread = await createChatThreadResolver(client)();
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
    const { client, driver } = await bootChatHarness({ mode: "manual" });
    const thread = await createChatThreadResolver(client)();
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
    const { client } = await bootChatHarness({ mode: "manual" });
    const thread = await createChatThreadResolver(client)();
    await client.threads.archive.$post({ json: { threadId: thread.id } });
    const outcome = await sendToThread(client, {
      threadId: thread.id,
      text: "hello?",
      activeTurnId: null,
    });
    expect(outcome.kind).toBe("refused");
  });
});

describe("the steer guard", () => {
  it("refuses an unguarded send into a running turn, and the client recovers", async () => {
    const { client, driver } = await bootChatHarness({ mode: "manual" });
    const thread = await createChatThreadResolver(client)();
    const started = await sendToThread(client, {
      threadId: thread.id,
      text: "first",
      activeTurnId: null,
    });
    if (started.kind !== "started") {
      throw new Error(`expected started, got ${started.kind}`);
    }

    // A raw unguarded steer — what a second window believing the thread idle
    // would send — is refused by the server rather than joining the turn.
    const blind = await client.threads.send.$post({
      json: { threadId: thread.id, text: "blind", mode: "steer-if-active" },
    });
    expect(blind.status).toBe(409);
    expect(driver.steeredTurns).toHaveLength(0);

    // The client's own path recovers from exactly that refusal.
    const recovered = await sendToThread(client, {
      threadId: thread.id,
      text: "recovered",
      activeTurnId: null,
    });
    expect(recovered).toEqual({ kind: "steered", turnId: started.turnId });
    expect(driver.steeredTurns.map((steer) => steer.text)).toEqual(["recovered"]);
  });
});

describe("the chat thread resolver", () => {
  it("mints the chat thread once and reuses it", async () => {
    const { client } = await bootChatHarness({ mode: "manual" });
    const resolve = createChatThreadResolver(client);
    const first = await resolve();
    const second = await resolve();
    expect(second.id).toBe(first.id);
    expect(first.originDocPath).toBeNull();
  });

  it("is single-flight: concurrent callers get ONE thread, not two", async () => {
    const { client } = await bootChatHarness({ mode: "manual" });
    const resolve = createChatThreadResolver(client);
    const [first, second, third] = await Promise.all([resolve(), resolve(), resolve()]);
    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
    const listed = await client.threads.list.$get();
    if (!listed.ok) {
      throw new Error("list refused");
    }
    const { threads } = await listed.json();
    expect(threads.filter((thread) => thread.originDocPath === null)).toHaveLength(1);
  });

  it("does not adopt a delegation thread as the chat", async () => {
    const { client } = await bootChatHarness({ mode: "manual" });
    await client.threads.create.$post({
      json: { originDocPath: "Doc.md", originAnchor: "anc_0123456789ab" },
    });
    const chat = await createChatThreadResolver(client)();
    expect(chat.originDocPath).toBeNull();
  });
});

describe("createDelegation", () => {
  it("anchors BEFORE the thread exists, then sends the composed first message", async () => {
    const { client, driver } = await bootChatHarness({ mode: "manual" });
    const events: string[] = [];
    const created = await createDelegation(client, {
      intent: "do",
      docPath: "Notes/Plans.md",
      selectionText: "First paragraph.",
      prompt: "Rewrite this",
      anchor: async (anchor) => {
        // The ordering, asserted from inside: no thread is bound to this doc
        // at the moment the anchor is being made durable.
        const byDoc = await client.threads["by-doc"].$get({
          query: { docPath: "Notes/Plans.md" },
        });
        if (!byDoc.ok) {
          throw new Error("by-doc refused");
        }
        expect((await byDoc.json()).threads).toHaveLength(0);
        events.push(`anchored:${anchor}`);
        return { ok: true };
      },
    });
    if (created.kind !== "created") {
      throw new Error(`expected created, got ${created.kind}`);
    }
    expect(events).toEqual([`anchored:${created.anchor}`]);
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
    const { client, driver } = await bootChatHarness({ mode: "manual" });
    await createDelegation(client, {
      intent: "ask",
      docPath: "Notes/Plans.md",
      selectionText: "First paragraph.",
      prompt: "What does this mean?",
      anchor: () => Promise.resolve({ ok: true }),
    });
    const sent = driver.startedTurns[0]?.text ?? "";
    expect(sent).toContain("do not modify any files");
    expect(sent).toContain("Question: What does this mean?");
  });

  for (const reason of ["block-gone", "no-editor", "save-failed"] as const) {
    it(`creates NO thread when the anchor fails: ${reason}`, async () => {
      const { client, driver } = await bootChatHarness({ mode: "manual" });
      const created = await createDelegation(client, {
        intent: "do",
        docPath: "Notes/Plans.md",
        selectionText: "First paragraph.",
        prompt: "Rewrite this",
        anchor: () => Promise.resolve({ ok: false, reason }),
      });
      expect(created).toEqual({ kind: "not-anchored", reason });
      // No orphan thread, and no turn was ever dispatched.
      const listed = await client.threads.list.$get();
      if (!listed.ok) {
        throw new Error("list refused");
      }
      expect((await listed.json()).threads).toHaveLength(0);
      expect(driver.startedTurns).toHaveLength(0);
    });
  }
});

describe("the inline approval card's answer", () => {
  it("round-trips the card's decision verb through the answer route", async () => {
    const { client, db } = await bootChatHarness({ mode: "manual" });
    const thread = await createChatThreadResolver(client)();
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
