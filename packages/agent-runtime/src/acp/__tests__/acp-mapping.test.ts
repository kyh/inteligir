// The pure halves of the ACP runtime: session updates onto the provider-event
// grammar, and permission requests onto the pending-interaction contract.

import { describe, expect, it } from "vitest";
import type { RequestPermissionRequest } from "@zed-industries/agent-client-protocol";
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
