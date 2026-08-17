// The runtime against a REAL child process speaking the codex app-server
// protocol (the fake in test-support): process lifecycle, dual-id stamping,
// event translation, the interactive round-trip at the JSON-RPC layer, and
// idle-session reaping.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  PendingInteractionCreate,
  PendingInteractionResolution,
} from "@repo/domain/pending-interactions";
import type { ThreadEvent } from "../domain/provider-event";
import { createAgentRuntimeWithAdapters } from "../runtime";
import type { AgentRuntime, AgentRuntimeExecutionOptions } from "../types";
import {
  createFakeCodexAdapterFactory,
  type FakeCodexMode,
} from "../test-support/fake-codex-adapter";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup();
  }
});

const options: AgentRuntimeExecutionOptions = {
  permissionMode: "accept-edits",
  permissionScope: "workspace",
  approvalReviewer: "user",
  permissionEscalation: "ask",
};

interface Harness {
  runtime: AgentRuntime;
  events: ThreadEvent[];
  interactions: PendingInteractionCreate[];
}

function bootRuntime(
  mode: FakeCodexMode,
  resolveInteraction?: (request: PendingInteractionCreate) => PendingInteractionResolution,
): Harness {
  const workspacePath = mkdtempSync(join(tmpdir(), "inteligir-runtime-test-"));
  cleanups.push(() => rmSync(workspacePath, { recursive: true, force: true }));
  const events: ThreadEvent[] = [];
  const interactions: PendingInteractionCreate[] = [];
  const runtime = createAgentRuntimeWithAdapters({
    workspacePath,
    adapterFactory: createFakeCodexAdapterFactory(mode),
    onEvent: (event) => {
      events.push(event);
    },
    onInteractiveRequest: (request) => {
      interactions.push(request);
      return Promise.resolve(resolveInteraction?.(request) ?? { decision: "deny" });
    },
  });
  cleanups.push(() => runtime.shutdown());
  return { runtime, events, interactions };
}

async function waitFor<T>(probe: () => T | undefined, what: string, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("the runtime over a fake codex app-server process", () => {
  it("runs a turn: identity resolves, events are stamped with the host thread id", async () => {
    const { runtime, events } = bootRuntime("happy");
    const { providerThreadId } = await runtime.startThread({
      threadId: "thr_a",
      providerId: "codex",
      options,
      instructions: "Be terse.",
    });
    expect(providerThreadId).toBe("cthr_1");
    expect(runtime.getProviderSession("thr_a")).toEqual({
      providerId: "codex",
      providerThreadId: "cthr_1",
    });

    await runtime.runTurn({
      threadId: "thr_a",
      input: [{ type: "text", text: "hello" }],
      options,
    });
    await waitFor(() => events.find((event) => event.type === "turn/completed"), "turn/completed");

    const types = events.map((event) => event.type);
    expect(types).toContain("turn/started");
    expect(types).toContain("item/agentMessage/delta");
    expect(events.every((event) => event.threadId === "thr_a")).toBe(true);
    const completedMessage = events.find(
      (event) => event.type === "item/completed" && event.item.type === "agentMessage",
    );
    expect(completedMessage).toMatchObject({
      item: { text: "Echo: hello" },
      scope: { kind: "turn", turnId: "cturn_1" },
    });
  });

  it("reaps the idle session and resumes by the persisted provider thread id", async () => {
    const { runtime, events } = bootRuntime("happy");
    const { providerThreadId } = await runtime.startThread({
      threadId: "thr_a",
      providerId: "codex",
      options,
    });
    await runtime.runTurn({ threadId: "thr_a", input: [{ type: "text", text: "one" }], options });
    await waitFor(() => events.find((event) => event.type === "turn/completed"), "turn one");

    const reaped = await runtime.reapIdleProviderSessions({ idleForMs: 0, nowMs: Date.now() });
    expect(reaped.reapedSessions).toMatchObject([
      { threadId: "thr_a", providerId: "codex", providerThreadId: "cthr_1" },
    ]);
    expect(runtime.hasThread("thr_a")).toBe(false);
    expect(runtime.listRunningProviders()).toEqual([]);

    const resumed = await runtime.resumeThread({
      threadId: "thr_a",
      providerThreadId,
      providerId: "codex",
      options,
    });
    expect(resumed.providerThreadId).toBe(providerThreadId);
    events.length = 0;
    await runtime.runTurn({ threadId: "thr_a", input: [{ type: "text", text: "two" }], options });
    const completed = await waitFor(
      () => events.find((event) => event.type === "turn/completed"),
      "turn two",
    );
    expect(completed.threadId).toBe("thr_a");
  });

  it("round-trips an approval: request decoded, resolution reaches the process", async () => {
    const { runtime, events, interactions } = bootRuntime("approval", () => ({
      decision: "allow_once",
      grantedPermissions: null,
    }));
    await runtime.startThread({ threadId: "thr_a", providerId: "codex", options });
    await runtime.runTurn({ threadId: "thr_a", input: [{ type: "text", text: "do it" }], options });

    await waitFor(() => events.find((event) => event.type === "turn/completed"), "turn settle");

    expect(interactions).toHaveLength(1);
    expect(interactions[0]).toMatchObject({
      threadId: "thr_a",
      providerId: "codex",
      turnId: "cturn_1",
      payload: { kind: "approval", subject: { kind: "command", command: "touch approved.md" } },
    });

    // The fake echoes the decision it received as an unknown notification,
    // which surfaces as provider/unhandled — proof the response reached it.
    const echoed = events.find(
      (event) => event.type === "provider/unhandled" && event.rawType === "fake/approvalResolved",
    );
    expect(echoed).toMatchObject({ rawEvent: { params: { decision: "accept" } } });

    const command = events.find(
      (event) => event.type === "item/completed" && event.item.type === "commandExecution",
    );
    expect(command).toMatchObject({ item: { status: "completed", exitCode: 0 } });
  });

  it("fails fast when the provider binary does not exist", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "inteligir-runtime-test-"));
    cleanups.push(() => rmSync(workspacePath, { recursive: true, force: true }));
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath,
      adapterFactory: () => ({
        ...createFakeCodexAdapterFactory("happy")("codex"),
        process: { command: "/nonexistent/codex-binary", args: ["app-server"] },
      }),
      onEvent: () => {},
    });
    cleanups.push(() => runtime.shutdown());
    await expect(
      runtime.startThread({ threadId: "thr_a", providerId: "codex", options }),
    ).rejects.toThrow();
  });
});
