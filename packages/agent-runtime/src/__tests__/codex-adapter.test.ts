// Protocol goldens for the codex adapter: command plans on the wire side,
// event translation on the way back, and the approval decode/encode pair.
// These pin the shapes the fake app-server (and the real one) exchange.

import { describe, expect, it } from "vitest";
import { createCodexProviderAdapter } from "../codex/adapter";
import { translateCodexEvent } from "../codex/event-translation";
import {
  buildCodexInteractiveResponse,
  decodeCodexInteractiveRequest,
} from "../codex/interactive-requests";
import type { ProviderExecutionContext } from "../provider-adapter";
import type { JsonObject } from "../vocabulary/json-value";

const workspaceOptions: ProviderExecutionContext = {
  permissionMode: "accept-edits",
  permissionScope: "workspace",
  approvalReviewer: "user",
  permissionEscalation: "ask",
  envVars: {},
};

function notification(method: string, params: JsonObject) {
  return { jsonrpc: "2.0", method, params };
}

describe("codex command plans", () => {
  const adapter = createCodexProviderAdapter();

  it("thread/start pins ephemeral off, subagents off and appended instructions", () => {
    const plan = adapter.buildCommandPlan({
      type: "thread/start",
      threadId: "thr_1",
      cwd: "/vault",
      options: { ...workspaceOptions, instructions: "Be terse." },
      instructionMode: "append",
    });
    expect(plan.kind).toBe("request");
    if (plan.kind !== "request") {
      return;
    }
    expect(plan.method).toBe("thread/start");
    expect(plan.params).toMatchObject({
      cwd: "/vault",
      ephemeral: false,
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      developerInstructions: "Be terse.",
      config: {
        "features.multi_agent": false,
        "memories.use_memories": false,
        "shell_environment_policy.set.INTELIGIR_THREAD_ID": "thr_1",
      },
    });
  });

  it("full permission scope maps to danger-full-access with approvals off", () => {
    const plan = adapter.buildCommandPlan({
      type: "turn/start",
      threadId: "thr_1",
      providerThreadId: "cthr_1",
      input: [{ type: "text", text: "hi" }],
      options: {
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
      },
    });
    expect(plan.kind).toBe("request");
    if (plan.kind !== "request") {
      return;
    }
    expect(plan.params).toMatchObject({
      threadId: "cthr_1",
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
      input: [{ type: "text", text: "hi", text_elements: [] }],
    });
  });

  it("thread/stop is a noop when idle and turn/interrupt when a turn runs", () => {
    const idle = adapter.buildCommandPlan({
      type: "thread/stop",
      threadId: "thr_1",
      providerThreadId: "cthr_1",
      activeTurnId: null,
    });
    expect(idle.kind).toBe("noop");
    const active = adapter.buildCommandPlan({
      type: "thread/stop",
      threadId: "thr_1",
      providerThreadId: "cthr_1",
      activeTurnId: "cturn_9",
    });
    expect(active).toMatchObject({
      kind: "request",
      method: "turn/interrupt",
      params: { threadId: "cthr_1", turnId: "cturn_9" },
    });
  });
});

describe("codex event translation", () => {
  it("translates the turn lifecycle under the provider's turn scope", () => {
    const started = translateCodexEvent(
      notification("turn/started", {
        threadId: "cthr_1",
        turn: { id: "cturn_1", status: "inProgress" },
      }),
    );
    expect(started).toEqual([
      {
        type: "turn/started",
        threadId: "cthr_1",
        providerThreadId: "cthr_1",
        scope: { kind: "turn", turnId: "cturn_1" },
      },
    ]);

    const completed = translateCodexEvent(
      notification("turn/completed", {
        threadId: "cthr_1",
        turn: { id: "cturn_1", status: "completed" },
      }),
    );
    expect(completed[0]).toMatchObject({ type: "turn/completed", status: "completed" });
  });

  it("translates a declined commandExecution as interrupted + denied", () => {
    const events = translateCodexEvent(
      notification("item/completed", {
        threadId: "cthr_1",
        turnId: "cturn_1",
        item: {
          type: "commandExecution",
          id: "cmd_1",
          command: "rm -rf notes",
          cwd: "/vault",
          status: "declined",
          aggregatedOutput: null,
          exitCode: null,
          durationMs: null,
        },
      }),
    );
    expect(events).toEqual([
      {
        type: "item/completed",
        threadId: "cthr_1",
        providerThreadId: "cthr_1",
        scope: { kind: "turn", turnId: "cturn_1" },
        item: {
          type: "commandExecution",
          id: "cmd_1",
          command: "rm -rf notes",
          cwd: "/vault",
          status: "interrupted",
          approvalStatus: "denied",
        },
      },
    ]);
  });

  it("maps codexErrorInfo onto the provider error taxonomy", () => {
    const events = translateCodexEvent(
      notification("error", {
        threadId: "cthr_1",
        turnId: "cturn_1",
        error: { message: "401 from upstream", codexErrorInfo: "unauthorized" },
        willRetry: false,
      }),
    );
    expect(events[0]).toMatchObject({
      type: "provider/error",
      detail: "401 from upstream",
      willRetry: false,
      errorInfo: { category: "unauthorized", providerCode: "unauthorized" },
    });
  });

  it("surfaces an unknown method as provider/unhandled and known noise as nothing", () => {
    const unknown = translateCodexEvent(notification("fake/approvalResolved", { threadId: "c1" }));
    expect(unknown[0]).toMatchObject({
      type: "provider/unhandled",
      rawType: "fake/approvalResolved",
      threadId: "c1",
    });

    expect(translateCodexEvent(notification("thread/status/changed", { threadId: "c1" }))).toEqual(
      [],
    );
  });
});

describe("codex approvals", () => {
  it("decodes a command approval into the pending-interaction payload", () => {
    const decoded = decodeCodexInteractiveRequest({
      id: 7,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "cthr_1",
        turnId: "cturn_1",
        itemId: "cmd_1",
        reason: "needs shell",
        command: "touch note.md",
        cwd: "/vault",
        availableDecisions: ["accept", "acceptForSession", "decline"],
      },
    });
    expect(decoded).toMatchObject({
      requestId: 7,
      providerThreadId: "cthr_1",
      turnId: "cturn_1",
      payload: {
        kind: "approval",
        reason: "needs shell",
        // allow_for_session is filtered out: the request carried no
        // grantable additionalPermissions, so there is nothing to grant.
        availableDecisions: ["allow_once", "deny"],
        subject: { kind: "command", command: "touch note.md", cwd: "/vault" },
      },
    });
  });

  it("encodes resolutions as codex decisions", () => {
    const decoded = decodeCodexInteractiveRequest({
      id: 7,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "cthr_1",
        turnId: "cturn_1",
        itemId: "cmd_1",
        command: "touch note.md",
      },
    });
    if (decoded === null) {
      throw new Error("decode failed");
    }
    expect(
      buildCodexInteractiveResponse({
        request: decoded,
        resolution: { decision: "allow_once", grantedPermissions: null },
      }),
    ).toEqual({ decision: "accept" });
    expect(
      buildCodexInteractiveResponse({ request: decoded, resolution: { decision: "deny" } }),
    ).toEqual({ decision: "decline" });
  });
});
