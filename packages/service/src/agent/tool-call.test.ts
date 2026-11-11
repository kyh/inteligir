// A tool call as its row reads, and every move it can and cannot take; `./agent-thread.test.ts`
// drives the loop's round, the person's answer and a stop over them.

import { describe, expect, it } from "vitest";

import { DECLINED, STOPPED, toolCallNext, toolCallOf } from "./tool-call";
import type { ToolCall, ToolCallEvent } from "./tool-call";

const ASKED: ToolCall = { kind: "asked" };
const AWAITING: ToolCall = { kind: "awaiting" };
const APPROVED: ToolCall = { kind: "approved" };
const DENIED: ToolCall = { kind: "denied", reason: "Keep it." };
const RUNNING: ToolCall = { kind: "running" };
const ANSWERED: ToolCall = { answer: { content: "Done.", isError: false }, kind: "answered" };

const RUN: ToolCallEvent = { kind: "run" };
const STOP: ToolCallEvent = { kind: "stop" };
const RESULT: ToolCallEvent = { answer: { content: "Found 3.", isError: false }, kind: "result" };
const ALLOW: ToolCallEvent = { approved: true, kind: "decide", reason: null };
const DENY: ToolCallEvent = { approved: false, kind: "decide", reason: "Keep it." };

const ROW = { decision: null, isError: 0, reason: null, result: null } as const;

describe("a tool call's row", () => {
  it("reads as the one state its status and decision mean", () => {
    expect(toolCallOf({ ...ROW, status: "pending" })).toStrictEqual(ASKED);
    expect(toolCallOf({ ...ROW, status: "awaiting_approval" })).toStrictEqual(AWAITING);
    expect(toolCallOf({ ...ROW, decision: "approved", status: "awaiting_approval" })).toStrictEqual(
      APPROVED,
    );
    expect(
      toolCallOf({ ...ROW, decision: "denied", reason: "Keep it.", status: "awaiting_approval" }),
    ).toStrictEqual(DENIED);
    expect(toolCallOf({ ...ROW, status: "running" })).toStrictEqual(RUNNING);
    expect(toolCallOf({ ...ROW, isError: 1, result: "Failed.", status: "done" })).toStrictEqual({
      answer: { content: "Failed.", isError: true },
      kind: "answered",
    });
  });
});

describe("a tool call's moves", () => {
  it("runs one asked for, approved, or cut mid-run, and answers a denied one with the person's words", () => {
    expect(toolCallNext(ASKED, RUN)).toStrictEqual(RUNNING);
    expect(toolCallNext(APPROVED, RUN)).toStrictEqual(RUNNING);
    expect(toolCallNext(RUNNING, RUN)).toStrictEqual(RUNNING);
    expect(toolCallNext(DENIED, RUN)).toStrictEqual({
      answer: { content: `${DECLINED} Keep it.`, isError: true },
      kind: "answered",
    });
    expect(toolCallNext({ kind: "denied", reason: null }, RUN)).toStrictEqual({
      answer: { content: DECLINED, isError: true },
      kind: "answered",
    });
  });

  it("runs nothing waiting on the person or answered", () => {
    expect(toolCallNext(AWAITING, RUN)).toBeNull();
    expect(toolCallNext(ANSWERED, RUN)).toBeNull();
  });

  it("takes the person's answer once, and only while it waits on them", () => {
    expect(toolCallNext(AWAITING, ALLOW)).toStrictEqual(APPROVED);
    expect(toolCallNext(AWAITING, DENY)).toStrictEqual(DENIED);
    for (const call of [ASKED, APPROVED, DENIED, RUNNING, ANSWERED]) {
      expect(toolCallNext(call, ALLOW)).toBeNull();
    }
  });

  it("lands a result only on a call that runs, never one the person did not approve", () => {
    expect(toolCallNext(RUNNING, RESULT)).toStrictEqual({
      answer: { content: "Found 3.", isError: false },
      kind: "answered",
    });
    for (const call of [ASKED, AWAITING, APPROVED, DENIED, ANSWERED]) {
      expect(toolCallNext(call, RESULT)).toBeNull();
    }
  });

  it("answers every open call on a stop, a denied one still with the person's words", () => {
    for (const call of [ASKED, AWAITING, APPROVED, RUNNING]) {
      expect(toolCallNext(call, STOP)).toStrictEqual({
        answer: { content: STOPPED, isError: true },
        kind: "answered",
      });
    }
    expect(toolCallNext(DENIED, STOP)).toStrictEqual({
      answer: { content: `${DECLINED} Keep it.`, isError: true },
      kind: "answered",
    });
    expect(toolCallNext(ANSWERED, STOP)).toBeNull();
  });
});
