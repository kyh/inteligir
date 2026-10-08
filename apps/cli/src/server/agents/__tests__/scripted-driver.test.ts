import type { TimelineRow } from "@repo/contract/local/thread-timeline";
import { describe, expect, it, vi } from "vitest";
import { resolveAgentDriver } from "../agent-driver";
import { SCRIPTED_ASK_PREFIX } from "../scripted-driver";
import { bootTestApp, listenTestApp } from "../../__tests__/boot-app";

const flatten = (rows: readonly TimelineRow[]): TimelineRow[] =>
  rows.flatMap((row): TimelineRow[] => (row.kind === "turn" ? [row, ...row.children] : [row]));

const bootScripted = async () => {
  const booted = await bootTestApp({
    agent: { detail: null, mode: "scripted", runtime: "scripted" },
    makeDriver: ({ bus, db }) =>
      resolveAgentDriver({ config: { agent: "scripted" }, db, notifier: bus }),
  });
  return await listenTestApp(booted);
};

describe("the scripted driver over real HTTP", () => {
  it("answers each turn with what it was asked, and settles the thread", async () => {
    const { client } = await bootScripted();

    const { thread } = await client.threads.create({});
    const sent = await client.threads.send({ text: "remember the milk", threadId: thread.id });
    if (sent.kind !== "started") {
      throw new Error(`expected the send to start a turn, got ${sent.kind}`);
    }

    const detail = await client.threads.get({ threadId: thread.id });
    expect(detail.thread.status).toBe("idle");
    const timeline = await client.threads.timeline({ threadId: thread.id });
    if (timeline.kind !== "full") {
      throw new Error("expected a full timeline");
    }
    const rows = flatten(timeline.timeline.rows);
    expect(rows.find((row) => row.kind === "conversation" && row.role === "user")).toMatchObject({
      text: "remember the milk",
    });
    expect(
      rows.find((row) => row.kind === "conversation" && row.role === "assistant"),
    ).toMatchObject({ text: "Noted: remember the milk", turnId: sent.turnId });
  });
});

type ScriptedClient = Awaited<ReturnType<typeof bootScripted>>["client"];

const assistantText = async (client: ScriptedClient, threadId: string): Promise<string | null> => {
  const timeline = await client.threads.timeline({ threadId });
  if (timeline.kind !== "full") {
    throw new Error("expected a full timeline");
  }
  const row = flatten(timeline.timeline.rows).find(
    (each) => each.kind === "conversation" && each.role === "assistant",
  );
  return row?.kind === "conversation" ? row.text : null;
};

const settlesIdle = async (client: ScriptedClient, threadId: string): Promise<void> => {
  await vi.waitFor(async () => {
    const detail = await client.threads.get({ threadId });
    expect(detail.thread.status).toBe("idle");
  });
};

describe("a scripted turn that asks first", () => {
  it("parks an approval card, and answers with the decision once it is given", async () => {
    const { client } = await bootScripted();
    const { thread } = await client.threads.create({});
    await client.threads.send({ text: `${SCRIPTED_ASK_PREFIX}rm drafts`, threadId: thread.id });

    const parked = await client.threads.get({ threadId: thread.id });
    expect(parked.thread.status).toBe("active");
    const [card] = parked.pendingInteractions;
    expect(card?.payload?.subject).toMatchObject({ command: "rm drafts", kind: "command" });
    if (card === undefined) {
      throw new Error("expected the approval card");
    }

    await client.threads.answerInteraction({
      interactionId: card.id,
      resolution: "allow_once",
      threadId: thread.id,
    });
    await settlesIdle(client, thread.id);
    expect(await assistantText(client, thread.id)).toBe("Allowed: rm drafts");
  });

  it("is stopped while it waits: the card goes and the turn ends interrupted", async () => {
    const { client } = await bootScripted();
    const { thread } = await client.threads.create({});
    await client.threads.send({ text: `${SCRIPTED_ASK_PREFIX}rm drafts`, threadId: thread.id });

    await client.threads.interrupt({ threadId: thread.id });
    await settlesIdle(client, thread.id);
    const settled = await client.threads.get({ threadId: thread.id });
    expect(settled.pendingInteractions).toEqual([]);
    expect(await assistantText(client, thread.id)).toBeNull();
  });
});
