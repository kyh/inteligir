import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDefinedError, safe } from "@orpc/client";
import { describe, expect, it } from "vitest";
import { resolveAgentDriver } from "../agent-driver";
import { scriptedNotePath } from "../scripted-driver";
import { bootTestApp, fakeAgentAccounts, TEST_MACHINE_NAME } from "../../__tests__/boot-app";
import type { BootedTestApp } from "../../__tests__/boot-app";
import {
  awaitThreadStatus,
  createThread,
  fakeSessionFacts,
  fetchTimelineRows,
  flattenTimelineRows,
  sendMessage,
} from "./agent-test-harness";
import { hermeticGitEnv } from "../../vault/__tests__/git-test-env";
import { undoCommitMessage } from "../../vault/turn-trailers";

const gitIn = (vaultDir: string, args: readonly string[]): string =>
  execFileSync("git", args, {
    cwd: vaultDir,
    encoding: "utf-8",
    env: {
      ...process.env,
      ...hermeticGitEnv(),
      GIT_AUTHOR_EMAIL: "a@b.c",
      GIT_AUTHOR_NAME: "A",
      GIT_COMMITTER_EMAIL: "a@b.c",
      GIT_COMMITTER_NAME: "A",
    },
  });

const gitLogHead = (vaultDir: string): string =>
  gitIn(vaultDir, ["log", "-1", "--format=%an%n%ae%n%cn%n%s%n%(trailers)"]);

const bootScripted = async (): Promise<BootedTestApp> =>
  await bootTestApp({
    agent: { detail: null, mode: "scripted", runtime: "scripted" },
    makeDriver: ({ db, bus, vault, vaultDir }) => {
      const resolved = resolveAgentDriver({
        accounts: fakeAgentAccounts(),
        config: {
          agent: "scripted",
          agentModels: { claude: null, codex: null },
          vaultDir,
        },
        db,
        notifier: bus,
        sessionFacts: () => fakeSessionFacts(),
        vault,
      });
      expect(resolved.status()).toEqual({ detail: null, mode: "scripted", runtime: "scripted" });
      return { createTurnDriver: resolved.createTurnDriver, dispose: resolved.dispose };
    },
  });

const runTurn = async (harness: BootedTestApp, threadId: string, text: string): Promise<string> => {
  const turnId = await sendMessage(harness.client, threadId, text);
  await awaitThreadStatus(harness.client, threadId, "idle");
  return turnId;
};

describe("the scripted driver over real HTTP", () => {
  it("runs the deterministic turn: timeline, vault file, agent-attributed commit", async () => {
    const harness = await bootScripted();

    const threadId = await createThread(harness.client);
    const turnId = await sendMessage(harness.client, threadId, "remember the milk");

    await awaitThreadStatus(harness.client, threadId, "idle");

    const rows = flattenTimelineRows(await fetchTimelineRows(harness.client, threadId));
    const user = rows.find((row) => row.kind === "conversation" && row.role === "user");
    expect(user).toMatchObject({ text: "remember the milk" });
    const assistant = rows.find((row) => row.kind === "conversation" && row.role === "assistant");
    expect(assistant).toMatchObject({ text: "Noted: remember the milk", turnId });
    const fileChange = rows.find((row) => row.kind === "work" && row.workKind === "file-change");
    expect(fileChange).toMatchObject({ status: "completed", turnId });

    const notePath = path.join(harness.vaultDir, scriptedNotePath(threadId));
    expect(readFileSync(notePath, "utf-8")).toContain("remember the milk");

    const head = gitLogHead(harness.vaultDir);
    const [authorName, authorEmail, committerName, subject, ...trailerLines] = head.split("\n");
    expect(authorName).toBe("inteligir-agent");
    expect(authorEmail).toBe("agent@inteligir.local");
    expect(committerName).toBe(TEST_MACHINE_NAME);
    expect(subject).toBe("agent: vault update");
    expect(trailerLines.join("\n")).toContain(`Thread: ${threadId}`);
    expect(trailerLines.join("\n")).toContain(`Turn: ${turnId}`);
  });
});

describe("a thread's turn changes", () => {
  it("lists each turn that changed the vault, oldest first, and flips one an undo names", async () => {
    const harness = await bootScripted();
    const threadId = await createThread(harness.client);
    const other = await createThread(harness.client);
    const first = await runTurn(harness, threadId, "remember the milk");
    await runTurn(harness, other, "another action's turn");
    const second = await runTurn(harness, threadId, "and the eggs");

    const agentNote = scriptedNotePath(threadId);
    expect(await harness.client.threads.turnChanges({ threadId })).toEqual({
      turns: [
        { paths: [agentNote], state: "applied", turnId: first },
        { paths: [agentNote], state: "applied", turnId: second },
      ],
    });

    writeFileSync(path.join(harness.vaultDir, agentNote), "# Agent note\n\nremember the milk\n");
    gitIn(harness.vaultDir, ["add", "-A"]);
    gitIn(harness.vaultDir, [
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      undoCommitMessage(threadId, second),
    ]);
    const { turns } = await harness.client.threads.turnChanges({ threadId });
    expect(turns.map((turn) => [turn.turnId, turn.state])).toEqual([
      [first, "applied"],
      [second, "undone"],
    ]);
  });

  it("answers an empty list for a thread with no turn, and NOT_FOUND for an unknown one", async () => {
    const harness = await bootScripted();
    const threadId = await createThread(harness.client);
    expect(await harness.client.threads.turnChanges({ threadId })).toEqual({ turns: [] });

    const [missing] = await safe(harness.client.threads.turnChanges({ threadId: "thr_missing" }));
    expect(isDefinedError(missing) && missing.code).toBe("NOT_FOUND");
  });
});
