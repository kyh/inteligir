// The codex runtime manager end to end, over real HTTP against a real fake
// app-server child process: turn-id rewriting onto the host's turn, the
// pending-interaction round trip through the answer route, provider session
// persistence, per-turn commit attribution, the account-restart window and
// the settle-before-drain race.

import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  createFakeCodexAdapterFactory,
  type FakeCodexMode,
} from "@repo/agent-runtime/test-support/fake-codex-adapter";
import type { PendingInteractionPayload } from "@repo/agent-runtime/domain/pending-interactions";
import { getThread } from "@repo/db/threads";
import { afterEach, describe, expect, it } from "vitest";
import { hermeticGitEnv } from "../../vault/__tests__/git-test-env";
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

const execFileAsync = promisify(execFile);

function makeMarkerDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "inteligir-codex-marker-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function bootWithManager(mode: FakeCodexMode, markerPath?: string): Promise<AgentAppHarness> {
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
        adapterFactory: createFakeCodexAdapterFactory(
          mode,
          markerPath !== undefined ? { markerPath } : undefined,
        ),
        reapIntervalMs: null,
      });
      return {
        createTurnDriver: manager.createTurnDriver,
        dispose: () => manager.dispose(),
      };
    },
  });
}

async function awaitThreadStatus(
  harness: AgentAppHarness,
  threadId: string,
  wanted: string,
): Promise<void> {
  await waitFor(
    async () =>
      (await getThreadDetail(harness.client, threadId)).status === wanted ? true : undefined,
    `the thread to reach ${wanted}`,
  );
}

/** The HEAD commit's author name, author email and file list. */
async function headCommit(
  vaultDir: string,
): Promise<{ author: string; email: string; files: string[] }> {
  const { stdout } = await execFileAsync(
    "git",
    ["show", "--name-only", "--format=%an%n%ae", "HEAD"],
    { cwd: vaultDir, env: { ...process.env, ...hermeticGitEnv() } },
  );
  const [author = "", email = "", ...rest] = stdout.split("\n");
  return { author, email, files: rest.filter((line) => line.length > 0) };
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
    // JSON form; the null grant on a permission_grant subject is filled from
    // the requested profile (the fallback the next test pins for bare verbs).
    expect(
      parseInteractionResolution(
        JSON.stringify({ decision: "allow_for_session", grantedPermissions: null }),
        grantPayload,
      ),
    ).toEqual({
      decision: "allow_for_session",
      grantedPermissions: { network: { enabled: true }, fileSystem: null },
    });
    // The request never offered allow_for_session: out-of-set is refused.
    expect(parseInteractionResolution("allow_for_session", commandPayload)).toBeNull();
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

    // The turn's reported write (an ABSOLUTE codex-shaped path) lands as an
    // agent-attributed commit holding exactly the turn's write set.
    const head = await waitFor(async () => {
      const commit = await headCommit(harness.vaultDir);
      return commit.author === "inteligir-agent" ? commit : undefined;
    }, "the agent-attributed commit");
    expect(head.email).toBe("agent@inteligir.local");
    expect(head.files).toEqual(["codex-note-1.md"]);
  });

  it("survives the account-restart window: a turn dispatched into it lands on the replacement", async () => {
    const marker = join(makeMarkerDir(), "auth-restored");
    const harness = await bootWithManager("auth-once", marker);
    const threadId = await createThread(harness.client);

    // Turn A fails with the provider's unauthorized error and flags the
    // thread-scoped process for an account restart.
    await sendMessage(harness.client, threadId, "first");
    await awaitThreadStatus(harness, threadId, "error");

    // Turn B is dispatched INTO the restart: the runtime replaces the
    // app-server process (an EXPECTED exit) before sending turn/start. B must
    // ride onto the replacement instead of being failed by that exit.
    const turnB = await sendMessage(harness.client, threadId, "second");
    await awaitThreadStatus(harness, threadId, "idle");

    const rows = flattenTimelineRows(await fetchTimelineRows(harness.client, threadId));
    const assistant = rows.find(
      (row) =>
        row.kind === "conversation" && row.role === "assistant" && row.text === "Echo: second",
    );
    expect(assistant).toMatchObject({ turnId: turnB });
  });

  it("settles a turn fully BEFORE the queue drain dispatches the next one", async () => {
    const harness = await bootWithManager("approval-once");
    const threadId = await createThread(harness.client);
    await sendMessage(harness.client, threadId, "first");

    const interaction = await waitFor(async () => {
      const detail = await getThreadDetail(harness.client, threadId);
      return detail.pendingInteractions[0];
    }, "the approval row");

    // Queue B while A is parked on the approval; answering A completes it,
    // and the ingest transaction drains B SYNCHRONOUSLY into startTurn.
    const queued = await harness.client.threads.send.$post({
      json: { threadId, text: "second", mode: "queue-if-active" },
    });
    expect(queued.status).toBe(200);

    const answered = await harness.client.threads.interaction.answer.$post({
      json: { threadId, interactionId: interaction.id, resolution: "allow_once" },
    });
    expect(answered.status).toBe(200);

    await waitFor(async () => {
      const rows = flattenTimelineRows(await fetchTimelineRows(harness.client, threadId));
      return rows.some(
        (row) =>
          row.kind === "conversation" && row.role === "assistant" && row.text === "Echo: second",
      )
        ? true
        : undefined;
    }, "the drained turn to complete");
    await awaitThreadStatus(harness, threadId, "idle");

    const rows = flattenTimelineRows(await fetchTimelineRows(harness.client, threadId));
    const completedTurns = rows.filter((row) => row.kind === "turn" && row.status === "completed");
    expect(completedTurns).toHaveLength(2);
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

    // The request offered no session grant, so its decodable decisions are
    // allow_once + deny; an out-of-set answer is refused before resolving.
    const outOfSet = await harness.client.threads.interaction.answer.$post({
      json: { threadId, interactionId: interaction.id, resolution: "allow_for_session" },
    });
    expect(outOfSet.status).toBe(400);

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
