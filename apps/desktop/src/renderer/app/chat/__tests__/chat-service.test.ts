// The composer's send flow against the REAL thread service (in-process app,
// typed client): the send-mode matrix including the unguarded-steer refusal,
// the single-flight chat resolver, the delegation create's ordering, and the
// approval answer the inline card emits.

import { noopNotifier } from "@repo/domain/notifier";
import { createPendingInteraction } from "@repo/db/pending-interactions";
import { isDefinedError, safe } from "@orpc/client";
import { describe, expect, it } from "vitest";
import { createChatThreadResolver, sendToThread } from "../chat-service";
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
    await client.threads.archive({ threadId: thread.id });
    const outcome = await sendToThread(client, {
      threadId: thread.id,
      text: "hello?",
      activeTurnId: null,
    });
    expect(outcome.kind).toBe("refused");
  });
});

describe("the view context a composer send carries", () => {
  const VIEW_CONTEXT = {
    surface: "doc",
    resource: "Notes/Plans.md",
    revision: "c".repeat(64),
    selection: { from: 6, to: 10, text: "beta" },
  } as const;

  it("reaches the provider dispatch through the real send path", async () => {
    const { client, driver } = await bootChatHarness({ mode: "manual" });
    const thread = await createChatThreadResolver(client)();
    const outcome = await sendToThread(client, {
      threadId: thread.id,
      text: "make this shorter",
      activeTurnId: null,
      viewContext: VIEW_CONTEXT,
    });
    expect(outcome.kind).toBe("started");
    expect(driver.startedTurns[0]?.viewContext).toEqual(VIEW_CONTEXT);
  });

  it("carries none when nothing is open — the palette and the CLI send this shape", async () => {
    const { client, driver } = await bootChatHarness({ mode: "manual" });
    const thread = await createChatThreadResolver(client)();
    await sendToThread(client, { threadId: thread.id, text: "hello", activeTurnId: null });
    expect(driver.startedTurns[0]?.viewContext).toBeUndefined();
  });

  it("survives the queue fallback as a DROP, not as a stale claim", async () => {
    const { client, driver } = await bootChatHarness({ mode: "manual", steerable: false });
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
      viewContext: VIEW_CONTEXT,
    });
    expect(queued.kind).toBe("queued");

    driver.completeTurn(thread.id, started.turnId, "completed");
    expect(driver.startedTurns[1]?.text).toBe("for later");
    expect(driver.startedTurns[1]?.viewContext).toBeUndefined();
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
    const [blind] = await safe(
      client.threads.send({ threadId: thread.id, text: "blind", mode: "steer-if-active" }),
    );
    expect(isDefinedError(blind) && blind.code).toBe("STALE_TURN");
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
    const { threads } = await client.threads.list();
    expect(threads.filter((thread) => thread.originDocPath === null)).toHaveLength(1);
  });

  it("does not adopt a delegation thread as the chat", async () => {
    const { client } = await bootChatHarness({ mode: "manual" });
    await client.threads.create({ originDocPath: "Doc.md", originAnchor: "anc_0123456789ab" });
    const chat = await createChatThreadResolver(client)();
    expect(chat.originDocPath).toBeNull();
  });
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

    const detail = await client.threads.get({ threadId: thread.id });
    expect(detail.pendingInteractions.map((row) => row.id)).toEqual([interaction.id]);

    // A decision the card would never render is refused server-side, which is
    // what keeps the card's availableDecisions filter honest rather than
    // decorative.
    const [unoffered] = await safe(
      client.threads.answerInteraction({
        threadId: thread.id,
        interactionId: interaction.id,
        resolution: "allow_for_session",
      }),
    );
    expect(isDefinedError(unoffered) && unoffered.code).toBe("INVALID_RESOLUTION");

    await client.threads.answerInteraction({
      threadId: thread.id,
      interactionId: interaction.id,
      resolution: "allow_once",
    });

    // Answered rows leave the open list, so the card stops rendering.
    const after = await client.threads.get({ threadId: thread.id });
    expect(after.pendingInteractions).toEqual([]);
  });
});
