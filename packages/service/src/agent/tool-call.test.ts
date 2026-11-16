// A tool call as its row reads and is written, and every move it can and cannot take; `./agent-thread.test.ts`
// drives the loop's round, the person's answer and a stop over them.

import { describe, expect, it } from "vitest";

import { DECLINED, STOPPED, toolCallColumns, toolCallNext, toolCallOf } from "./tool-call";
import type { ToolCall, ToolCallEvent } from "./tool-call";

const ASKED: ToolCall = { kind: "asked" };
const AWAITING: ToolCall = { kind: "awaiting" };
const APPROVED: ToolCall = { kind: "approved" };
const DENIED: ToolCall = { kind: "denied" };
const RUNNING: ToolCall = { kind: "running" };
const ANSWERED: ToolCall = { answer: { content: "Done.", isError: false }, kind: "answered" };

const RUN: ToolCallEvent = { kind: "run" };
const STOP: ToolCallEvent = { kind: "stop" };
const RESULT: ToolCallEvent = { answer: { content: "Found 3.", isError: false }, kind: "result" };
const ALLOW: ToolCallEvent = { approved: true, kind: "decide" };
const DENY: ToolCallEvent = { approved: false, kind: "decide" };

describe("a tool call's row", () => {
  it("holds every call as the state it is in, and reads back as that call", () => {
    for (const call of [ASKED, AWAITING, APPROVED, DENIED, RUNNING]) {
      expect(toolCallColumns(call)).toStrictEqual({ isError: 0, result: null, state: call.kind });
      expect(toolCallOf(toolCallColumns(call))).toStrictEqual(call);
    }
    const failed: ToolCall = { answer: { content: "Failed.", isError: true }, kind: "answered" };
    expect(toolCallColumns(failed)).toStrictEqual({
      isError: 1,
      result: "Failed.",
      state: "answered",
    });
    expect(toolCallOf(toolCallColumns(failed))).toStrictEqual(failed);
  });
});

describe("a tool call's moves", () => {
  it("runs one asked for, approved, or cut mid-run, and answers a denied one that the person declined", () => {
    expect(toolCallNext(ASKED, RUN)).toStrictEqual(RUNNING);
    expect(toolCallNext(APPROVED, RUN)).toStrictEqual(RUNNING);
    expect(toolCallNext(RUNNING, RUN)).toStrictEqual(RUNNING);
    expect(toolCallNext(DENIED, RUN)).toStrictEqual({
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

  it("answers every open call on a stop, a denied one still that the person declined", () => {
    for (const call of [ASKED, AWAITING, APPROVED, RUNNING]) {
      expect(toolCallNext(call, STOP)).toStrictEqual({
        answer: { content: STOPPED, isError: true },
        kind: "answered",
      });
    }
    expect(toolCallNext(DENIED, STOP)).toStrictEqual({
      answer: { content: DECLINED, isError: true },
      kind: "answered",
    });
    expect(toolCallNext(ANSWERED, STOP)).toBeNull();
  });
});
