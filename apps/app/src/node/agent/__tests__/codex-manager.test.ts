// The codex runtime manager end to end, over real HTTP against a real fake
// app-server child process: turn-id rewriting onto the host's turn, the
// pending-interaction round trip through the answer route, provider session
// persistence, per-turn commit attribution, the account-restart window and
// the settle-before-drain race.

import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  createFakeCodexAdapterFactory,
  type FakeCodexMode,
} from "@repo/agent-runtime/test-support/fake-codex-adapter";
import {
  parseApprovalResolution,
  type PendingInteractionPayload,
} from "@repo/domain/pending-interactions";
import { getThread } from "@repo/db/threads";
import { describe, expect, it } from "vitest";
import { hermeticGitEnv } from "../../vault/__tests__/git-test-env";
import { createCodexRuntimeManager, type CodexRuntimeManagerDeps } from "../runtime-manager";
import { bootTestApp, type BootedTestApp } from "../../__tests__/boot-app";
import { makeTempDir } from "../../__tests__/temp-dir";
import {
  createThread,
  fetchTimelineRows,
  flattenTimelineRows,
  getThreadDetail,
  sendMessage,
  waitFor,
} from "./agent-test-harness";

const execFileAsync = promisify(execFile);

interface ManagerOptions {
  markerPath?: string;
  turnIdleTimeoutMs?: number;
}

async function bootWithManager(
  mode: FakeCodexMode,
  options: ManagerOptions = {},
): Promise<BootedTestApp> {
  return bootTestApp({
    agent: { mode: "codex", runtime: "codex", detail: null },
    makeDriver: ({ db, bus, vault, vaultDir }) => {
      const deps: CodexRuntimeManagerDeps = {
        db,
        notifier: bus,
        vaultDir,
        git: vault.git,
        model: null,
        adapterFactory: createFakeCodexAdapterFactory(
          mode,
          options.markerPath !== undefined ? { markerPath: options.markerPath } : undefined,
        ),
        reapIntervalMs: null,
      };
      if (options.turnIdleTimeoutMs !== undefined) {
        deps.turnIdleTimeoutMs = options.turnIdleTimeoutMs;
      }
      const manager = createCodexRuntimeManager(deps);
      return {
        createTurnDriver: manager.createTurnDriver,
        dispose: () => manager.dispose(),
      };
    },
  });
}

async function awaitThreadStatus(
  harness: BootedTestApp,
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

describe("parseApprovalResolution", () => {
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
    expect(parseApprovalResolution("deny", commandPayload)).toEqual({
      ok: true,
      resolution: { decision: "deny" },
    });
    expect(parseApprovalResolution("allow_once", commandPayload)).toEqual({
      ok: true,
      resolution: { decision: "allow_once", grantedPermissions: null },
    });
    // JSON form; the null grant on a permission_grant subject is filled from
    // the requested profile (the fallback the next test pins for bare verbs).
    expect(
      parseApprovalResolution(
        JSON.stringify({ decision: "allow_for_session", grantedPermissions: null }),
        grantPayload,
      ),
    ).toEqual({
      ok: true,
      resolution: {
        decision: "allow_for_session",
        grantedPermissions: { network: { enabled: true }, fileSystem: null },
      },
    });
    // The request never offered allow_for_session: out-of-set is refused.
    expect(parseApprovalResolution("allow_for_session", commandPayload).ok).toBe(false);
    expect(parseApprovalResolution("approve!!", commandPayload).ok).toBe(false);
    expect(parseApprovalResolution('{"decision":"maybe"}', commandPayload).ok).toBe(false);
    // A valid decision with wrong-shape grantedPermissions is refused, never
    // parsed down to its decision alone.
    expect(
      parseApprovalResolution(
        JSON.stringify({ decision: "allow_once", grantedPermissions: { bogus: true } }),
        commandPayload,
      ).ok,
    ).toBe(false);
  });

  it("an allow with no explicit grant falls back to the requested permissions", () => {
    expect(parseApprovalResolution("allow_for_session", grantPayload)).toEqual({
      ok: true,
      resolution: {
        decision: "allow_for_session",
        grantedPermissions: { network: { enabled: true }, fileSystem: null },
      },
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
    const marker = join(makeTempDir("inteligir-codex-marker-"), "auth-restored");
    const harness = await bootWithManager("auth-once", { markerPath: marker });
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

    // A valid decision wrapped around wrong-shape grantedPermissions is 400
    // at the route — never accepted here and silently denied downstream.
    const unknownPermissions = await harness.client.threads.interaction.answer.$post({
      json: {
        threadId,
        interactionId: interaction.id,
        resolution: JSON.stringify({ decision: "allow_once", grantedPermissions: { bogus: 1 } }),
      },
    });
    expect(unknownPermissions.status).toBe(400);

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

  it("fails a turn the provider accepted and then went silent on", async () => {
    // The process stays healthy, so onProcessExit never fires — nothing else
    // settles this shape, and the turn's commit hold defers the vault's
    // auto-commit and blocks every sync pass for as long as it is open.
    const harness = await bootWithManager("hang", { turnIdleTimeoutMs: 150 });
    const threadId = await createThread(harness.client);
    const turnId = await sendMessage(harness.client, threadId, "wedge me");

    await awaitThreadStatus(harness, threadId, "error");

    // Failed through the ordinary grammar — a provider/error and a failed
    // turn, under the host's own turn id — not a special case downstream.
    const rows = flattenTimelineRows(await fetchTimelineRows(harness.client, threadId));
    expect(rows.find((row) => row.kind === "turn")).toMatchObject({ turnId, status: "error" });
    expect(rows.find((row) => row.kind === "error")).toMatchObject({
      message: "The agent provider failed",
      detail:
        "The agent produced nothing for 150ms; the turn was abandoned so the vault can commit and sync again",
    });

    // The per-thread state was released with it: the thread takes a new turn
    // rather than answering "already has a running turn".
    const next = await harness.client.threads.send.$post({
      json: { threadId, text: "again", mode: "steer-if-active" },
    });
    expect(next.status).toBe(200);
  });
});
