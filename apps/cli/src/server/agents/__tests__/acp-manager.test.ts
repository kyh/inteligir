// The runtime manager end to end over the REAL ACP wire: a scripted agent
// child (fake-acp-agent.mjs) speaks the protocol through the official lib,
// so what this suite pins is the whole production path — spawn, initialize,
// session identity, prompt streaming under the HOST's turn id, the
// pending-interaction round trip, commit attribution from fileChange items,
// the settle-before-drain race, and the silent-turn watchdog.

import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AcpAgentRuntimeOptions } from "@repo/agent-runtime/acp/acp-runtime";
import type { AgentRuntimeShellEnvironment } from "@repo/agent-runtime/types";
import {
  parseApprovalResolution,
  type PendingInteractionPayload,
} from "@repo/domain/pending-interactions";
import { getThread } from "@repo/db/threads";
import { isDefinedError, safe } from "@orpc/client";
import { describe, expect, it } from "vitest";
import { hermeticGitEnv } from "../../vault/__tests__/git-test-env";
import { CLI_POINTER_INSTRUCTIONS } from "../agent-instructions";
import { createAcpRuntimeManager, type AcpRuntimeManagerDeps } from "../runtime-manager";
import { bootTestApp, type BootedTestApp } from "../../__tests__/boot-app";
import {
  createThread,
  fetchTimelineRows,
  flattenTimelineRows,
  getThreadDetail,
  sendMessage,
  waitFor,
} from "./agent-test-harness";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const FAKE_AGENT = require.resolve("@repo/agent-runtime/test-support/fake-acp-agent");

type FakeAcpMode = "message" | "fileChange" | "approval" | "promptEcho" | "silent";

interface ManagerOptions {
  cliBinDir?: string;
  filePath?: string;
  turnIdleTimeoutMs?: number;
}

function fakeSpawn(
  mode: FakeAcpMode,
  options: ManagerOptions,
): AcpAgentRuntimeOptions["spawnAdapter"] {
  return (_harness, env) => {
    const childEnv: AgentRuntimeShellEnvironment = { ...env, FAKE_ACP_MODE: mode };
    if (options.filePath !== undefined) childEnv.FAKE_ACP_FILE = options.filePath;
    const child = spawn(process.execPath, [FAKE_AGENT], {
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { child };
  };
}

async function bootWithManager(
  mode: FakeAcpMode,
  options: ManagerOptions = {},
): Promise<BootedTestApp> {
  return bootTestApp({
    agent: { mode: "auto", runtime: "acp", detail: null },
    makeDriver: ({ db, bus, vault, vaultDir }) => {
      const deps: AcpRuntimeManagerDeps = {
        db,
        notifier: bus,
        vaultDir,
        git: vault.git,
        model: null,
        mcpServers: () => [],
        shellEnv: () => ({}),
        cliBinDir: options.cliBinDir ?? null,
        connectedDirs: () => [],
        defaultProviderId: "codex",
        spawnAdapter: fakeSpawn(mode, options),
        reapIntervalMs: null,
      };
      if (options.turnIdleTimeoutMs !== undefined) {
        deps.turnIdleTimeoutMs = options.turnIdleTimeoutMs;
      }
      const manager = createAcpRuntimeManager(deps);
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
    },
    reason: null,
    availableDecisions: ["allow_once", "deny"],
  };

  it("accepts bare verbs and refuses out-of-set decisions", () => {
    expect(parseApprovalResolution("deny", commandPayload)).toEqual({
      ok: true,
      resolution: { decision: "deny" },
    });
    expect(parseApprovalResolution("allow_once", commandPayload)).toEqual({
      ok: true,
      resolution: { decision: "allow_once" },
    });
    expect(parseApprovalResolution("allow_for_session", commandPayload).ok).toBe(false);
    expect(parseApprovalResolution("approve!!", commandPayload).ok).toBe(false);
  });
});

describe("the ACP runtime manager over real HTTP", () => {
  it("streams a provider turn into the timeline under the HOST's turn id", async () => {
    const harness = await bootWithManager("message");
    const threadId = await createThread(harness.client);
    const turnId = await sendMessage(harness.client, threadId, "hello agent");

    await awaitThreadStatus(harness, threadId, "idle");

    const rows = flattenTimelineRows(await fetchTimelineRows(harness.client, threadId));
    const assistant = rows.find((row) => row.kind === "conversation" && row.role === "assistant");
    expect(assistant).toMatchObject({ text: "hello from the fake agent", turnId });

    // The provider session is persisted for resume across restarts/reaps.
    expect(getThread(harness.db, threadId)).toMatchObject({
      providerId: "codex",
      providerThreadId: "fakeacp_1",
      status: "idle",
      activeTurnId: null,
    });
  });

  it("opens the session by putting its standing instructions first in the prompt", async () => {
    // ACP's session/new carries no instructions field, so the FIRST turn's
    // leading text block is the only channel they have. The fake echoes that
    // block back, which is what makes this an assertion about the wire rather
    // than about a recording double.
    const harness = await bootWithManager("promptEcho", { cliBinDir: "/repo/apps/cli/bin" });
    const threadId = await createThread(harness.client);
    await sendMessage(harness.client, threadId, "hello agent");
    await awaitThreadStatus(harness, threadId, "idle");

    const rows = flattenTimelineRows(await fetchTimelineRows(harness.client, threadId));
    const echoed = rows.find((row) => row.kind === "conversation" && row.role === "assistant");
    if (echoed?.kind !== "conversation") {
      throw new Error("expected the echoed prompt");
    }
    expect(echoed.text).toContain(CLI_POINTER_INSTRUCTIONS);
    expect(echoed.text).toContain("$INTELIGIR_SKILLS_DIR");
    expect(echoed.text).not.toContain("hello agent");
  });

  it("stages a fileChange item's write set as the agent-attributed commit", async () => {
    // Mutated after boot: the vault dir exists only then, and the spawn seam
    // reads the options object at session open (the first send).
    const managerOptions: ManagerOptions = {};
    const harness = await bootWithManager("fileChange", managerOptions);
    managerOptions.filePath = join(harness.vaultDir, "agent-note.md");
    const threadId = await createThread(harness.client);
    await sendMessage(harness.client, threadId, "edit the note");
    await awaitThreadStatus(harness, threadId, "idle");

    const head = await waitFor(async () => {
      const commit = await headCommit(harness.vaultDir);
      return commit.author === "inteligir-agent" ? commit : undefined;
    }, "the agent-attributed commit");
    expect(head.email).toBe("agent@inteligir.local");
    expect(head.files).toEqual(["agent-note.md"]);
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
        subject: { kind: "command", command: "rm -rf scratch" },
      },
    });

    // The fake offered allow_once + reject_once only, so allow_for_session is
    // out-of-set and refused at the route.
    const [outOfSet] = await safe(
      harness.client.threads.answerInteraction({
        threadId,
        interactionId: interaction.id,
        resolution: "allow_for_session",
      }),
    );
    expect(isDefinedError(outOfSet) && outOfSet.code).toBe("INVALID_RESOLUTION");

    await harness.client.threads.answerInteraction({
      threadId,
      interactionId: interaction.id,
      resolution: "allow_once",
    });

    await awaitThreadStatus(harness, threadId, "idle");
    const rows = flattenTimelineRows(await fetchTimelineRows(harness.client, threadId));
    const approvedChunk = rows.find(
      (row) =>
        row.kind === "conversation" && row.role === "assistant" && row.text === "approved and done",
    );
    expect(approvedChunk).toMatchObject({ turnId });
    expect((await getThreadDetail(harness.client, threadId)).pendingInteractions).toEqual([]);
  });

  it("settles a turn fully BEFORE the queue drain dispatches the next one", async () => {
    const harness = await bootWithManager("approval");
    const threadId = await createThread(harness.client);
    await sendMessage(harness.client, threadId, "first");

    const interaction = await waitFor(async () => {
      const detail = await getThreadDetail(harness.client, threadId);
      return detail.pendingInteractions[0];
    }, "the approval row");

    // Queue B while A is parked on the approval; answering A completes it,
    // and the drain dispatches B onto the same session.
    const queued = await harness.client.threads.send({
      threadId,
      text: "second",
    });
    expect(queued.kind).toBe("queued");

    await harness.client.threads.answerInteraction({
      threadId,
      interactionId: interaction.id,
      resolution: "allow_once",
    });

    await waitFor(async () => {
      const rows = flattenTimelineRows(await fetchTimelineRows(harness.client, threadId));
      const completedTurns = rows.filter(
        (row) => row.kind === "turn" && row.status === "completed",
      );
      return completedTurns.length === 2 ? true : undefined;
    }, "both turns to complete");
    await awaitThreadStatus(harness, threadId, "idle");
  });

  it("fails a turn the provider accepted and then went silent on", async () => {
    const harness = await bootWithManager("silent", { turnIdleTimeoutMs: 150 });
    const threadId = await createThread(harness.client);
    const turnId = await sendMessage(harness.client, threadId, "wedge me");

    await awaitThreadStatus(harness, threadId, "error");

    const rows = flattenTimelineRows(await fetchTimelineRows(harness.client, threadId));
    expect(rows.find((row) => row.kind === "turn")).toMatchObject({ turnId, status: "error" });

    // The per-thread state was released with it: the thread takes a new turn
    // rather than answering "already has a running turn".
    const next = await harness.client.threads.send({
      threadId,
      text: "again",
    });
    expect(next.kind).toBe("started");
  });
});
