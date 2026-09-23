import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import type { AcpAgentRuntimeOptions } from "@repo/agent-runtime/acp/acp-runtime";
import type { AgentRuntimeShellEnvironment } from "@repo/agent-runtime/types";
import { parseApprovalResolution } from "@repo/domain/pending-interactions";
import type { PendingInteractionPayload } from "@repo/domain/pending-interactions";
import { getThread } from "@repo/db/threads";
import { isDefinedError, safe } from "@orpc/client";
import { describe, expect, it, vi } from "vitest";
import type { TurnDriver } from "../../threads/turn-driver";
import { hermeticGitEnv } from "../../vault/__tests__/git-test-env";
import { CLI_POINTER_INSTRUCTIONS } from "../agent-instructions";
import { createAcpRuntimeManager } from "../runtime-manager";
import type { AcpRuntimeManager, AcpRuntimeManagerDeps } from "../runtime-manager";
import { bootTestApp } from "../../__tests__/boot-app";
import type { BootedTestApp } from "../../__tests__/boot-app";
import {
  awaitPendingInteraction,
  awaitThreadStatus,
  createThread,
  fakeSessionFacts,
  fetchTimelineRows,
  flattenTimelineRows,
  getThreadDetail,
  PROVIDER_WAIT,
  sendMessage,
} from "./agent-test-harness";

const require = createRequire(import.meta.url);
const FAKE_AGENT = require.resolve("@repo/agent-runtime/test-support/fake-acp-agent");

type FakeAcpMode =
  | "message"
  | "fileChange"
  | "approval"
  | "promptEcho"
  | "silent"
  | "authOnSessionOpen"
  | "authOnPrompt"
  | "crashOnBoot";

interface ManagerOptions {
  cliBinDir?: string;
  skillsDir?: string;
  filePath?: string;
  turnIdleTimeoutMs?: number;
  // mutable on purpose: the Settings-edited fact, read per session open.
  connectedDirs?: string[];
  spawnedEnvs?: Record<string, string>[];
  children?: ChildProcess[];
  // mutable on purpose: a sign-in between two sends, read at the next session open.
  mode?: FakeAcpMode;
}

interface ManagerHarness extends BootedTestApp {
  manager: AcpRuntimeManager;
  driver: TurnDriver;
}

const fakeSpawn =
  (mode: FakeAcpMode, options: ManagerOptions): AcpAgentRuntimeOptions["spawnAdapter"] =>
  (_harness, env) => {
    options.spawnedEnvs?.push(env);
    const childEnv: AgentRuntimeShellEnvironment = {
      ...env,
      FAKE_ACP_MODE: options.mode ?? mode,
    };
    if (options.filePath !== undefined) {
      childEnv.FAKE_ACP_FILE = options.filePath;
    }
    const child = spawn(process.execPath, [FAKE_AGENT], {
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    options.children?.push(child);
    return { child };
  };

const bootWithManager = async (
  mode: FakeAcpMode,
  options: ManagerOptions = {},
): Promise<ManagerHarness> => {
  const wired: { manager: AcpRuntimeManager; driver: TurnDriver }[] = [];
  const booted = await bootTestApp({
    agent: { detail: null, mode: "auto", runtime: "acp" },
    makeDriver: ({ db, bus, vault, vaultDir }) => {
      const deps: AcpRuntimeManagerDeps = {
        db,
        defaultProviderId: () => "codex",
        git: vault.git,
        hostEnv: {},
        mcpServers: () => [],
        model: null,
        notifier: bus,
        reapIntervalMs: null,
        sessionFacts: () =>
          fakeSessionFacts({
            cliBinDir: options.cliBinDir ?? null,
            connectedDirs: [...(options.connectedDirs ?? [])],
            skillsDir: options.skillsDir ?? null,
          }),
        spawnAdapter: fakeSpawn(mode, options),
        vaultDir,
      };
      if (options.turnIdleTimeoutMs !== undefined) {
        deps.turnIdleTimeoutMs = options.turnIdleTimeoutMs;
      }
      const manager = createAcpRuntimeManager(deps);
      return {
        createTurnDriver: (sink) => {
          const driver = manager.createTurnDriver(sink);
          wired.push({ driver, manager });
          return driver;
        },
        dispose: async () => {
          await manager.dispose();
        },
      };
    },
  });
  const [driven] = wired;
  if (driven === undefined) {
    throw new Error("the thread service never asked for its turn driver");
  }
  return { ...booted, ...driven };
};

const hasExited = (child: ChildProcess): boolean =>
  child.exitCode !== null || child.signalCode !== null;

const awaitExited = async (children: readonly ChildProcess[]): Promise<void> => {
  await vi.waitFor(() => {
    expect(children.filter((child) => !hasExited(child))).toEqual([]);
  }, PROVIDER_WAIT);
};

const headCommit = (vaultDir: string) => {
  const stdout = execFileSync("git", ["show", "--name-only", "--format=%an%n%ae", "HEAD"], {
    cwd: vaultDir,
    encoding: "utf-8",
    env: { ...process.env, ...hermeticGitEnv() },
  });
  const [author = "", email = "", ...rest] = stdout.split("\n");
  return { author, email, files: rest.filter((line) => line.length > 0) };
};

describe("parseApprovalResolution", () => {
  const commandPayload: PendingInteractionPayload = {
    availableDecisions: ["allow_once", "deny"],
    kind: "approval",
    reason: null,
    subject: {
      command: "ls",
      cwd: null,
      itemId: "cmd_1",
      kind: "command",
    },
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

    await awaitThreadStatus(harness.client, threadId, "idle");

    const rows = flattenTimelineRows(await fetchTimelineRows(harness.client, threadId));
    const assistant = rows.find((row) => row.kind === "conversation" && row.role === "assistant");
    expect(assistant).toMatchObject({ text: "hello from the fake agent", turnId });

    const thread = getThread(harness.db, threadId);
    expect(thread).toMatchObject({ activeTurnId: null, providerId: "codex", status: "idle" });
    expect(thread?.providerThreadId).toMatch(/^fakeacp_\d+_1$/u);
  });

  it("opens the session by putting its standing instructions first in the prompt", async () => {
    const harness = await bootWithManager("promptEcho", {
      cliBinDir: "/repo/apps/cli/bin",
      skillsDir: "/repo/packages/agent-skills/skills",
    });
    const threadId = await createThread(harness.client);
    await sendMessage(harness.client, threadId, "hello agent");
    await awaitThreadStatus(harness.client, threadId, "idle");

    const rows = flattenTimelineRows(await fetchTimelineRows(harness.client, threadId));
    const echoed = rows.find((row) => row.kind === "conversation" && row.role === "assistant");
    if (echoed?.kind !== "conversation") {
      throw new Error("expected the echoed prompt");
    }
    expect(echoed.text).toContain(CLI_POINTER_INSTRUCTIONS);
    expect(echoed.text).toContain("$INTELIGIR_SKILLS_DIR");
    expect(echoed.text).not.toContain("hello agent");
  });

  it("reads the session facts at every session open: a folder added after the first turn reaches the next session's env AND prompt", async () => {
    const connectedDirs: string[] = [];
    const spawnedEnvs: Record<string, string>[] = [];
    const harness = await bootWithManager("promptEcho", { connectedDirs, spawnedEnvs });

    const first = await createThread(harness.client);
    await sendMessage(harness.client, first, "first session");
    await awaitThreadStatus(harness.client, first, "idle");

    connectedDirs.push("/ref/added-in-settings");
    const second = await createThread(harness.client);
    await sendMessage(harness.client, second, "second session");
    await awaitThreadStatus(harness.client, second, "idle");

    expect(spawnedEnvs.map((env) => env.INTELIGIR_CONNECTED_DIRS)).toEqual([
      undefined,
      "/ref/added-in-settings",
    ]);
    const rows = flattenTimelineRows(await fetchTimelineRows(harness.client, second));
    const echoedPrompt = rows.find(
      (row) => row.kind === "conversation" && row.role === "assistant",
    );
    if (echoedPrompt?.kind !== "conversation") {
      throw new Error("expected the echoed prompt");
    }
    expect(echoedPrompt.text).toContain("/ref/added-in-settings");
  });

  it("stages a fileChange item's write set as the agent-attributed commit", async () => {
    // set after boot: the vault dir exists only then, and the spawn seam reads the options at session open.
    const managerOptions: ManagerOptions = {};
    const harness = await bootWithManager("fileChange", managerOptions);
    managerOptions.filePath = path.join(harness.vaultDir, "agent-note.md");
    const threadId = await createThread(harness.client);
    await sendMessage(harness.client, threadId, "edit the note");
    await awaitThreadStatus(harness.client, threadId, "idle");

    const head = await vi.waitFor(() => {
      const commit = headCommit(harness.vaultDir);
      expect(commit.author).toBe("inteligir-agent");
      return commit;
    }, PROVIDER_WAIT);
    expect(head.email).toBe("agent@inteligir.local");
    expect(head.files).toEqual(["agent-note.md"]);
  });

  it("round-trips an approval through pending_interactions and the answer route", async () => {
    const harness = await bootWithManager("approval");
    const threadId = await createThread(harness.client);
    const turnId = await sendMessage(harness.client, threadId, "please run it");

    const interaction = await awaitPendingInteraction(harness.client, threadId);
    expect(interaction).toMatchObject({
      payload: {
        kind: "approval",
        subject: { command: "rm -rf scratch", kind: "command" },
      },
      status: "pending",
      threadId,
      turnId,
    });

    // the fake offers allow_once and reject_once only.
    const [outOfSet] = await safe(
      harness.client.threads.answerInteraction({
        interactionId: interaction.id,
        resolution: "allow_for_session",
        threadId,
      }),
    );
    expect(isDefinedError(outOfSet) && outOfSet.code).toBe("INVALID_RESOLUTION");

    await harness.client.threads.answerInteraction({
      interactionId: interaction.id,
      resolution: "allow_once",
      threadId,
    });

    await awaitThreadStatus(harness.client, threadId, "idle");
    const rows = flattenTimelineRows(await fetchTimelineRows(harness.client, threadId));
    const approvedChunk = rows.find(
      (row) =>
        row.kind === "conversation" && row.role === "assistant" && row.text === "approved and done",
    );
    expect(approvedChunk).toMatchObject({ turnId });
    const detail = await getThreadDetail(harness.client, threadId);
    expect(detail.pendingInteractions).toEqual([]);
  });

  it("settles a turn fully BEFORE the queue drain dispatches the next one", async () => {
    const harness = await bootWithManager("approval");
    const threadId = await createThread(harness.client);
    await sendMessage(harness.client, threadId, "first");

    const interaction = await awaitPendingInteraction(harness.client, threadId);

    const queued = await harness.client.threads.send({
      text: "second",
      threadId,
    });
    expect(queued.kind).toBe("queued");

    await harness.client.threads.answerInteraction({
      interactionId: interaction.id,
      resolution: "allow_once",
      threadId,
    });

    await vi.waitFor(async () => {
      const rows = flattenTimelineRows(await fetchTimelineRows(harness.client, threadId));
      const completedTurns = rows.filter(
        (row) => row.kind === "turn" && row.status === "completed",
      );
      expect(completedTurns).toHaveLength(2);
    }, PROVIDER_WAIT);
    await awaitThreadStatus(harness.client, threadId, "idle");
  });

  it("names the harness and its login command when session/new is refused for auth", async () => {
    const harness = await bootWithManager("authOnSessionOpen");
    const threadId = await createThread(harness.client);
    await sendMessage(harness.client, threadId, "hello agent");

    await awaitThreadStatus(harness.client, threadId, "error");

    const rows = flattenTimelineRows(await fetchTimelineRows(harness.client, threadId));
    expect(rows.find((row) => row.kind === "error")).toMatchObject({
      detail: "Codex is not signed in — run: codex login",
      message: "The agent provider failed",
    });
  });

  it("fails a prompt refused for auth with the login hint", async () => {
    const harness = await bootWithManager("authOnPrompt");
    const threadId = await createThread(harness.client);
    const turnId = await sendMessage(harness.client, threadId, "hello agent");

    await awaitThreadStatus(harness.client, threadId, "error");

    const rows = flattenTimelineRows(await fetchTimelineRows(harness.client, threadId));
    expect(rows.find((row) => row.kind === "error")).toMatchObject({
      message: "Codex is not signed in — run: codex login",
      turnId,
    });
  });

  it("opens a fresh session on the send after a sign-in, not the one session/new refused", async () => {
    const children: ChildProcess[] = [];
    const managerOptions: ManagerOptions = { children };
    const harness = await bootWithManager("authOnSessionOpen", managerOptions);
    const threadId = await createThread(harness.client);
    await sendMessage(harness.client, threadId, "signed out");
    await awaitThreadStatus(harness.client, threadId, "error");
    await awaitExited(children);

    managerOptions.mode = "message";
    const turnId = await sendMessage(harness.client, threadId, "signed in");
    await awaitThreadStatus(harness.client, threadId, "idle");

    const rows = flattenTimelineRows(await fetchTimelineRows(harness.client, threadId));
    const assistant = rows.find((row) => row.kind === "conversation" && row.role === "assistant");
    expect(assistant).toMatchObject({ text: "hello from the fake agent", turnId });
  });

  it("leaves no child behind when a resumed thread's session/load and session/new are both refused", async () => {
    const children: ChildProcess[] = [];
    const managerOptions: ManagerOptions = { children };
    const harness = await bootWithManager("message", managerOptions);
    const threadId = await createThread(harness.client);
    await sendMessage(harness.client, threadId, "signed in");
    await awaitThreadStatus(harness.client, threadId, "idle");
    const [first] = children;
    first?.kill("SIGKILL");
    await awaitExited(children);

    managerOptions.mode = "authOnSessionOpen";
    await sendMessage(harness.client, threadId, "signed out since");
    await awaitThreadStatus(harness.client, threadId, "error");

    // the resume's child and the fresh start's child, each refused and each gone.
    expect(children).toHaveLength(3);
    await awaitExited(children);
    await harness.manager.dispose();
    expect(children.filter((child) => !hasExited(child))).toEqual([]);
  });

  it("fails a turn whose adapter dies before the handshake, naming what it said on stderr", async () => {
    const harness = await bootWithManager("crashOnBoot");
    const threadId = await createThread(harness.client);
    await sendMessage(harness.client, threadId, "hello agent");

    await awaitThreadStatus(harness.client, threadId, "error");

    const rows = flattenTimelineRows(await fetchTimelineRows(harness.client, threadId));
    expect(rows.find((row) => row.kind === "error")).toMatchObject({
      detail: "The Codex adapter exited (code 3): fake agent: cannot start",
      message: "The agent provider failed",
    });
  });

  it("fails a turn whose adapter dies mid-prompt through the turn's own grammar", async () => {
    const children: ChildProcess[] = [];
    const harness = await bootWithManager("silent", { children });
    const threadId = await createThread(harness.client);
    const turnId = await sendMessage(harness.client, threadId, "wedge me");
    await vi.waitFor(async () => {
      const rows = flattenTimelineRows(await fetchTimelineRows(harness.client, threadId));
      expect(rows.find((row) => row.kind === "turn")).toMatchObject({ turnId });
    }, PROVIDER_WAIT);

    const [child] = children;
    child?.kill("SIGKILL");
    await awaitThreadStatus(harness.client, threadId, "error");

    const rows = flattenTimelineRows(await fetchTimelineRows(harness.client, threadId));
    expect(rows.find((row) => row.kind === "error")).toMatchObject({
      message: "The Codex adapter exited (signal SIGKILL)",
      turnId,
    });
  });

  it("closes the session of a turn the provider went silent on, so the next turn runs on a fresh child", async () => {
    const children: ChildProcess[] = [];
    const managerOptions: ManagerOptions = { children, turnIdleTimeoutMs: 150 };
    const harness = await bootWithManager("silent", managerOptions);
    const threadId = await createThread(harness.client);
    const silentTurnId = await sendMessage(harness.client, threadId, "wedge me");

    await awaitThreadStatus(harness.client, threadId, "error");

    const failed = flattenTimelineRows(await fetchTimelineRows(harness.client, threadId));
    expect(failed.find((row) => row.kind === "turn")).toMatchObject({
      status: "error",
      turnId: silentTurnId,
    });

    managerOptions.mode = "message";
    const turnId = await sendMessage(harness.client, threadId, "again");
    await awaitThreadStatus(harness.client, threadId, "idle");

    const rows = flattenTimelineRows(await fetchTimelineRows(harness.client, threadId));
    const assistant = rows.find((row) => row.kind === "conversation" && row.role === "assistant");
    expect(assistant).toMatchObject({ text: "hello from the fake agent", turnId });
    expect(children).toHaveLength(2);
    await awaitExited(children.slice(0, 1));
  });

  it("spawns nothing for a dispatch that resumes after dispose", async () => {
    const children: ChildProcess[] = [];
    const harness = await bootWithManager("message", { children });
    const threadId = await createThread(harness.client);

    // straight to the driver: the dispatch parks on the vault lock, so dispose lands before it spawns.
    harness.driver.startTurn({ text: "too late", threadId, turnId: "turn_after_dispose" });
    await harness.manager.dispose();
    await harness.vault.git.runExclusive(async () => {
      await Promise.resolve();
    });
    await setImmediate();

    expect(children).toEqual([]);
  });
});
