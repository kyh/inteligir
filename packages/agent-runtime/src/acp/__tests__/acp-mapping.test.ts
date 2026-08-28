// The pure halves of the ACP runtime: session updates onto the provider-event
// grammar, and permission requests onto the pending-interaction contract.

import { describe, expect, it } from "vitest";
import type { RequestPermissionRequest } from "@zed-industries/agent-client-protocol";
import { AcpTurnMapper } from "../acp-event-mapping";
import { toApprovalPayload, toPermissionOutcome } from "../acp-permission-mapping";

const CTX = { providerThreadId: "sess_1", threadId: "thr_1", turnId: "turn_1" };

function mapper(): AcpTurnMapper {
  return new AcpTurnMapper({ ...CTX });
}

describe("AcpTurnMapper", () => {
  it("opens one message item on the first chunk and closes it whole at completion", () => {
    const m = mapper();
    const first = m.update({
      sessionId: "sess_1",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hel" } },
    });
    expect(first.map((event) => event.type)).toEqual(["item/started", "item/agentMessage/delta"]);
    const second = m.update({
      sessionId: "sess_1",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "lo" } },
    });
    expect(second.map((event) => event.type)).toEqual(["item/agentMessage/delta"]);
    const done = m.completed("end_turn");
    expect(done.at(-1)).toMatchObject({ type: "turn/completed", status: "completed" });
    const closed = done.find((event) => event.type === "item/completed");
    expect(closed).toMatchObject({ item: { type: "agentMessage", text: "hello" } });
  });

  it("lands an edit-kind tool call as a fileChange item with its locations", () => {
    const m = mapper();
    m.update({
      sessionId: "sess_1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_1",
        title: "Edit note.md",
        kind: "edit",
        status: "in_progress",
        locations: [{ path: "/vault/note.md" }],
      },
    });
    const settled = m.update({
      sessionId: "sess_1",
      update: { sessionUpdate: "tool_call_update", toolCallId: "call_1", status: "completed" },
    });
    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({
      type: "item/completed",
      item: {
        type: "fileChange",
        id: "call_1",
        status: "completed",
        changes: [{ kind: "update", path: "/vault/note.md" }],
      },
    });
  });

  it("interrupts open items when a turn is cancelled", () => {
    const m = mapper();
    m.update({
      sessionId: "sess_1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_1",
        title: "sleep 100",
        kind: "execute",
        status: "in_progress",
      },
    });
    const events = m.completed("cancelled");
    expect(events[0]).toMatchObject({
      type: "item/completed",
      item: { type: "commandExecution", status: "interrupted" },
    });
    expect(events.at(-1)).toMatchObject({ type: "turn/completed", status: "interrupted" });
  });

  it("fails the turn through the grammar on a prompt rejection", () => {
    const m = mapper();
    const events = m.failed("adapter died");
    expect(events.map((event) => event.type)).toEqual(["provider/error", "turn/completed"]);
    expect(events[1]).toMatchObject({ status: "failed", error: { message: "adapter died" } });
  });
});

describe("permission mapping", () => {
  const request: RequestPermissionRequest = {
    sessionId: "sess_1",
    options: [
      { optionId: "y", kind: "allow_once", name: "Allow" },
      { optionId: "n", kind: "reject_once", name: "Deny" },
    ],
    toolCall: { toolCallId: "call_9", title: "rm -rf scratch", kind: "execute", status: "pending" },
  };

  it("derives a command subject and the offered decisions", () => {
    expect(toApprovalPayload(request)).toEqual({
      kind: "approval",
      reason: null,
      availableDecisions: ["allow_once", "deny"],
      subject: {
        kind: "command",
        itemId: "call_9",
        command: "rm -rf scratch",
        cwd: null,
      },
    });
  });

  it("derives a file_change subject for edit-kind calls", () => {
    const editRequest: RequestPermissionRequest = {
      ...request,
      toolCall: {
        toolCallId: "call_2",
        title: "Edit a.md",
        kind: "edit",
        status: "pending",
        locations: [{ path: "/vault/a.md" }],
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
