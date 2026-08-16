// The codex runtime manager end to end, over real HTTP against a real fake
// app-server child process: turn-id rewriting onto the host's turn, the
// pending-interaction round trip through the answer route, and provider
// session persistence into the threads row.

import { createFakeCodexAdapterFactory } from "@repo/agent-runtime/test-support/fake-codex-adapter";
import type { PendingInteractionPayload } from "@repo/agent-runtime/domain/pending-interactions";
import { getThread } from "@repo/db/threads";
import { afterEach, describe, expect, it } from "vitest";
import { createCodexRuntimeManager, parseInteractionResolution } from "../runtime-manager";
import {
  bootAgentApp,
  createThread,
  fetchTimelineRows,
  flattenTimelineRows,
  getThreadDetail,
  sendMessage,
  waitFor,
  type AgentAppHarness,
} from "./agent-test-harness";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup();
  }
});

async function bootWithManager(mode: "happy" | "approval"): Promise<AgentAppHarness> {
  return bootAgentApp({
    agent: { mode: "codex", runtime: "codex", detail: null },
    cleanups,
    makeDriver: ({ db, bus, vault, vaultDir }) => {
      const manager = createCodexRuntimeManager({
        db,
        notifier: bus,
        vaultDir,
        git: vault.git,
        model: null,
        adapterFactory: createFakeCodexAdapterFactory(mode),
        reapIntervalMs: null,
      });
      return {
        createTurnDriver: manager.createTurnDriver,
        dispose: () => manager.dispose(),
      };
    },
  });
}

describe("parseInteractionResolution", () => {
  const commandPayload: PendingInteractionPayload = {
    kind: "approval",
    subject: {
      kind: "command",
      itemId: "cmd_1",
      command: "ls",
      cwd: null,
      actions: [],
      sessionGrant: null,
    },
    reason: null,
    availableDecisions: ["allow_once", "deny"],
  };
  const grantPayload: PendingInteractionPayload = {
    kind: "approval",
    subject: {
      kind: "permission_grant",
      itemId: "perm_1",
      toolName: null,
      permissions: { network: { enabled: true }, fileSystem: null },
    },
    reason: null,
    availableDecisions: ["allow_once", "allow_for_session", "deny"],
  };

  it("accepts bare verbs and the full resolution JSON, refuses the rest", () => {
    expect(parseInteractionResolution("deny", commandPayload)).toEqual({ decision: "deny" });
    expect(parseInteractionResolution("allow_once", commandPayload)).toEqual({
      decision: "allow_once",
      grantedPermissions: null,
    });
    expect(
      parseInteractionResolution(
        JSON.stringify({ decision: "allow_for_session", grantedPermissions: null }),
        commandPayload,
      ),
    ).toEqual({ decision: "allow_for_session", grantedPermissions: null });
    expect(parseInteractionResolution("approve!!", commandPayload)).toBeNull();
    expect(parseInteractionResolution('{"decision":"maybe"}', commandPayload)).toBeNull();
  });

  it("an allow with no explicit grant falls back to the requested permissions", () => {
    expect(parseInteractionResolution("allow_for_session", grantPayload)).toEqual({
      decision: "allow_for_session",
      grantedPermissions: { network: { enabled: true }, fileSystem: null },
    });
  });
});

describe("the codex runtime manager over real HTTP", () => {
  it("streams a provider turn into the timeline under the HOST's turn id", async () => {
    const harness = await bootWithManager("happy");
    const threadId = await createThread(harness.client);
    const turnId = await sendMessage(harness.client, threadId, "hello codex");

    await waitFor(
      async () =>
        (await getThreadDetail(harness.client, threadId)).status === "idle" ? true : undefined,
      "the thread to settle idle",
    );

    const rows = flattenTimelineRows(await fetchTimelineRows(harness.client, threadId));
    const assistant = rows.find((row) => row.kind === "conversation" && row.role === "assistant");
    expect(assistant).toMatchObject({ text: "Echo: hello codex", turnId });

    // The provider session is persisted for resume across restarts/reaps.
    expect(getThread(harness.db, threadId)).toMatchObject({
      providerId: "codex",
      providerThreadId: "cthr_1",
      status: "idle",
      activeTurnId: null,
    });
  });

  it("round-trips an approval through pending_interactions and the answer route", async () => {
    const harness = await bootWithManager("approval");
    const threadId = await createThread(harness.client);
    const turnId = await sendMessage(harness.client, threadId, "please run it");

    const interaction = await waitFor(async () => {
      const detail = await getThreadDetail(harness.client, threadId);
      return detail.pendingInteractions[0];
    }, "the approval row");
    expect(interaction).toMatchObject({
      threadId,
      turnId,
      status: "pending",
      payload: {
        kind: "approval",
        subject: { kind: "command", command: "touch approved.md" },
      },
    });

    const answered = await harness.client.threads.interaction.answer.$post({
      json: { threadId, interactionId: interaction.id, resolution: "allow_once" },
    });
    expect(answered.status).toBe(200);

    await waitFor(
      async () =>
        (await getThreadDetail(harness.client, threadId)).status === "idle" ? true : undefined,
      "the approved turn to settle",
    );

    const rows = flattenTimelineRows(await fetchTimelineRows(harness.client, threadId));
    const command = rows.find((row) => row.kind === "work" && row.workKind === "command");
    expect(command).toMatchObject({ status: "completed", turnId });
    expect((await getThreadDetail(harness.client, threadId)).pendingInteractions).toEqual([]);
  });
});
