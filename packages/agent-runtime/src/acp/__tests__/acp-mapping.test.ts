// The pure halves of the ACP runtime: session updates onto the provider-event
// grammar, and permission requests onto the pending-interaction contract.

import { describe, expect, it } from "vitest";
import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import { AcpTurnMapper } from "../acp-event-mapping";
import { toApprovalPayload, toPermissionOutcome } from "../acp-permission-mapping";

const CTX = { providerThreadId: "sess_1", threadId: "thr_1", turnId: "turn_1" };

const mapper = (): AcpTurnMapper => new AcpTurnMapper({ ...CTX });

describe("AcpTurnMapper", () => {
  it("opens one message item on the first chunk and closes it whole at completion", () => {
    const m = mapper();
    const first = m.update({
      sessionId: "sess_1",
      update: { content: { text: "hel", type: "text" }, sessionUpdate: "agent_message_chunk" },
    });
    expect(first.map((event) => event.type)).toEqual(["item/started", "item/agentMessage/delta"]);
    const second = m.update({
      sessionId: "sess_1",
      update: { content: { text: "lo", type: "text" }, sessionUpdate: "agent_message_chunk" },
    });
    expect(second.map((event) => event.type)).toEqual(["item/agentMessage/delta"]);
    const done = m.completed("end_turn");
    expect(done.at(-1)).toMatchObject({ status: "completed", type: "turn/completed" });
    const closed = done.find((event) => event.type === "item/completed");
    expect(closed).toMatchObject({ item: { text: "hello", type: "agentMessage" } });
  });

  it("lands an edit-kind tool call as a fileChange item with its locations", () => {
    const m = mapper();
    m.update({
      sessionId: "sess_1",
      update: {
        kind: "edit",
        locations: [{ path: "/vault/note.md" }],
        sessionUpdate: "tool_call",
        status: "in_progress",
        title: "Edit note.md",
        toolCallId: "call_1",
      },
    });
    const settled = m.update({
      sessionId: "sess_1",
      update: { sessionUpdate: "tool_call_update", status: "completed", toolCallId: "call_1" },
    });
    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({
      item: {
        changes: [{ kind: "update", path: "/vault/note.md" }],
        id: "call_1",
        status: "completed",
        type: "fileChange",
      },
      type: "item/completed",
    });
  });

  it("interrupts open items when a turn is cancelled", () => {
    const m = mapper();
    m.update({
      sessionId: "sess_1",
      update: {
        kind: "execute",
        sessionUpdate: "tool_call",
        status: "in_progress",
        title: "sleep 100",
        toolCallId: "call_1",
      },
    });
    const events = m.completed("cancelled");
    expect(events[0]).toMatchObject({
      item: { status: "interrupted", type: "commandExecution" },
      type: "item/completed",
    });
    expect(events.at(-1)).toMatchObject({ status: "interrupted", type: "turn/completed" });
  });

  it("fails the turn through the grammar on a prompt rejection", () => {
    const m = mapper();
    const events = m.failed("adapter died");
    expect(events.map((event) => event.type)).toEqual(["provider/error", "turn/completed"]);
    expect(events[1]).toMatchObject({ error: { message: "adapter died" }, status: "failed" });
  });

  it("streams thoughts into one reasoning item and closes it whole", () => {
    const m = mapper();
    const thought = (text: string) =>
      m.update({
        sessionId: "sess_1",
        update: { content: { text, type: "text" }, sessionUpdate: "agent_thought_chunk" },
      });
    expect(thought("weigh ").map((event) => event.type)).toEqual([
      "item/started",
      "item/reasoning/textDelta",
    ]);
    expect(thought("options").map((event) => event.type)).toEqual(["item/reasoning/textDelta"]);
    expect(m.completed("end_turn")).toContainEqual(
      expect.objectContaining({
        item: {
          content: ["weigh options"],
          id: "turn_1:reasoning",
          summary: [],
          type: "reasoning",
        },
        type: "item/completed",
      }),
    );
  });

  it("maps a plan's entries onto steps, in_progress as active", () => {
    const [event] = mapper().update({
      sessionId: "sess_1",
      update: {
        entries: [
          { content: "read note.md", priority: "high", status: "completed" },
          { content: "summarize it", priority: "medium", status: "in_progress" },
          { content: "report back", priority: "low", status: "pending" },
        ],
        sessionUpdate: "plan",
      },
    });
    expect(event).toMatchObject({
      plan: [
        { status: "completed", step: "read note.md" },
        { status: "active", step: "summarize it" },
        { status: "pending", step: "report back" },
      ],
      type: "turn/plan/updated",
    });
  });

  it("completes a tool the adapter reports failed as failed", () => {
    const m = mapper();
    m.update({
      sessionId: "sess_1",
      update: {
        kind: "execute",
        sessionUpdate: "tool_call",
        status: "in_progress",
        title: "cat missing.md",
        toolCallId: "call_1",
      },
    });
    const [event] = m.update({
      sessionId: "sess_1",
      update: { sessionUpdate: "tool_call_update", status: "failed", toolCallId: "call_1" },
    });
    expect(event).toMatchObject({
      item: { command: "cat missing.md", status: "failed", type: "commandExecution" },
      type: "item/completed",
    });
  });

  it("replaces a tool's content rather than appending to it", () => {
    const m = mapper();
    m.update({
      sessionId: "sess_1",
      update: {
        content: [{ content: { text: "List files", type: "text" }, type: "content" }],
        kind: "execute",
        sessionUpdate: "tool_call",
        status: "in_progress",
        title: "ls",
        toolCallId: "call_1",
      },
    });
    const [event] = m.update({
      sessionId: "sess_1",
      update: {
        content: [{ content: { text: "a.md\nb.md", type: "text" }, type: "content" }],
        sessionUpdate: "tool_call_update",
        status: "completed",
        toolCallId: "call_1",
      },
    });
    expect(event).toMatchObject({ item: { aggregatedOutput: "a.md\nb.md" } });
  });

  it.each(["refusal", "max_tokens", "max_turn_requests"] as const)(
    "fails a turn that stopped for %s",
    (stopReason) => {
      expect(mapper().completed(stopReason).at(-1)).toMatchObject({
        status: "failed",
        type: "turn/completed",
      });
    },
  );

  it("lands codex's own warning as a notice, never as the message", () => {
    const m = mapper();
    expect(
      m.update({
        sessionId: "sess_1",
        update: {
          content: { text: "Warning: Skill descriptions were shortened.\n\n", type: "text" },
          sessionUpdate: "agent_message_chunk",
        },
      }),
    ).toEqual([
      expect.objectContaining({
        message: "Skill descriptions were shortened.",
        severity: "warning",
        type: "provider/notice",
      }),
    ]);
    m.update({
      sessionId: "sess_1",
      update: {
        content: { text: "pong", type: "text" },
        messageId: "msg_1",
        sessionUpdate: "agent_message_chunk",
      },
    });
    expect(m.completed("end_turn")).toContainEqual(
      expect.objectContaining({ item: expect.objectContaining({ text: "pong" }) }),
    );
  });

  it("keeps a warning the model wrote itself in its message", () => {
    const events = mapper().update({
      sessionId: "sess_1",
      update: {
        content: { text: "Warning: this deletes the note.\n\n", type: "text" },
        messageId: "msg_1",
        sessionUpdate: "agent_message_chunk",
      },
    });
    expect(events.map((event) => event.type)).toEqual(["item/started", "item/agentMessage/delta"]);
  });

  it("lands a protocol notice as the same notice", () => {
    expect(
      mapper().update({
        sessionId: "sess_1",
        update: {
          description: "Conversation compacted to fit the model's context window.",
          sessionUpdate: "notice",
          severity: "info",
          title: "Context compacted",
        },
      }),
    ).toEqual([
      expect.objectContaining({
        message: "Context compacted: Conversation compacted to fit the model's context window.",
        severity: "info",
        type: "provider/notice",
      }),
    ]);
  });

  it("lands a codex shell command as a command carrying its raw output, whatever its kind", () => {
    const m = mapper();
    const [started] = m.update({
      sessionId: "sess_1",
      update: {
        kind: "read",
        name: "exec_command",
        sessionUpdate: "tool_call",
        status: "in_progress",
        title: "List files",
        toolCallId: "exec_1",
      },
    });
    expect(started).toMatchObject({ item: { type: "commandExecution" }, type: "item/started" });
    const [completed] = m.update({
      sessionId: "sess_1",
      update: {
        name: "exec_command",
        rawOutput: { exit_code: 0, formatted_output: "a.md\nb.md\n" },
        sessionUpdate: "tool_call_update",
        status: "completed",
        toolCallId: "exec_1",
      },
    });
    expect(completed).toMatchObject({
      item: {
        aggregatedOutput: "a.md\nb.md\n",
        command: "List files",
        status: "completed",
        type: "commandExecution",
      },
      type: "item/completed",
    });
  });

  it("drops an update for a tool call it never saw opened, which no recorded adapter sends", () => {
    expect(
      mapper().update({
        sessionId: "sess_1",
        update: { sessionUpdate: "tool_call_update", status: "completed", toolCallId: "call_x" },
      }),
    ).toEqual([]);
  });
});

describe("permission mapping", () => {
  const request: RequestPermissionRequest = {
    options: [
      { kind: "allow_once", name: "Allow", optionId: "y" },
      { kind: "reject_once", name: "Deny", optionId: "n" },
    ],
    sessionId: "sess_1",
    toolCall: { kind: "execute", status: "pending", title: "rm -rf scratch", toolCallId: "call_9" },
  };

  it("derives a command subject and the offered decisions", () => {
    expect(toApprovalPayload(request)).toEqual({
      availableDecisions: ["allow_once", "deny"],
      kind: "approval",
      reason: null,
      subject: {
        command: "rm -rf scratch",
        cwd: null,
        itemId: "call_9",
        kind: "command",
      },
    });
  });

  it("derives a file_change subject for edit-kind calls", () => {
    const editRequest: RequestPermissionRequest = {
      ...request,
      toolCall: {
        kind: "edit",
        locations: [{ path: "/vault/a.md" }],
        status: "pending",
        title: "Edit a.md",
        toolCallId: "call_2",
      },
    };
    expect(toApprovalPayload(editRequest).subject).toMatchObject({
      kind: "file_change",
      writeScope: "/vault/a.md",
    });
  });

  it("answers with the agent's own optionId, in-family fallback included", () => {
    expect(toPermissionOutcome(request, { decision: "allow_once" })).toEqual({
      optionId: "y",
      outcome: "selected",
    });
    expect(toPermissionOutcome(request, { decision: "allow_for_session" })).toEqual({
      optionId: "y",
      outcome: "selected",
    });
    expect(toPermissionOutcome(request, { decision: "deny" })).toEqual({
      optionId: "n",
      outcome: "selected",
    });
  });
});
