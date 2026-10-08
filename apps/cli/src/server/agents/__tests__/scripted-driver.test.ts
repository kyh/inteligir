import type { TimelineRow } from "@repo/contract/local/thread-timeline";
import { describe, expect, it } from "vitest";
import { resolveAgentDriver } from "../agent-driver";
import { bootTestApp, listenTestApp } from "../../__tests__/boot-app";

const flatten = (rows: readonly TimelineRow[]): TimelineRow[] =>
  rows.flatMap((row): TimelineRow[] => (row.kind === "turn" ? [row, ...row.children] : [row]));

describe("the scripted driver over real HTTP", () => {
  it("answers each turn with what it was asked, and settles the thread", async () => {
    const booted = await bootTestApp({
      agent: { detail: null, mode: "scripted", runtime: "scripted" },
      makeDriver: ({ bus }) => resolveAgentDriver({ config: { agent: "scripted" }, notifier: bus }),
    });
    const { client } = await listenTestApp(booted);

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
