// INTELIGIR_AGENT=scripted end to end over real HTTP: the deterministic turn
// streams into the timeline, the note lands in the vault through the vault
// service, and the commit is agent-attributed (author = the agent, committer
// = the engine, thread id in the trailer).

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { resolveAgentDriver } from "../agent-driver";
import { scriptedNotePath } from "../scripted-driver";
import { bootTestApp } from "../../__tests__/boot-app";
import {
  createThread,
  fetchTimelineRows,
  flattenTimelineRows,
  getThreadDetail,
  sendMessage,
  waitFor,
} from "./agent-test-harness";
import { hermeticGitEnv } from "../../vault/__tests__/git-test-env";

const execFileAsync = promisify(execFile);

async function gitLogHead(vaultDir: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["log", "-1", "--format=%an%n%ae%n%cn%n%s%n%(trailers)"],
    { cwd: vaultDir, env: { ...process.env, ...hermeticGitEnv() } },
  );
  return stdout;
}

describe("the scripted driver over real HTTP", () => {
  it("runs the deterministic turn: timeline, vault file, agent-attributed commit", async () => {
    const harness = await bootTestApp({
      agent: { mode: "scripted", runtime: "scripted", detail: null },
      makeDriver: ({ db, bus, vault, vaultDir }) => {
        const resolved = resolveAgentDriver({
          config: {
            agent: "scripted",
            agentModel: null,
            vaultDir,
          },
          db,
          notifier: bus,
          vault,
          mcpServers: () => [],
          shellEnv: () => ({}),
          cliBinDir: null,
          connectedDirs: () => [],
        });
        expect(resolved.status).toEqual({ mode: "scripted", runtime: "scripted", detail: null });
        return { createTurnDriver: resolved.createTurnDriver, dispose: resolved.dispose };
      },
    });

    const threadId = await createThread(harness.client);
    const turnId = await sendMessage(harness.client, threadId, "remember the milk");

    await waitFor(
      async () =>
        (await getThreadDetail(harness.client, threadId)).status === "idle" ? true : undefined,
      "the scripted turn to settle",
    );

    const rows = flattenTimelineRows(await fetchTimelineRows(harness.client, threadId));
    const user = rows.find((row) => row.kind === "conversation" && row.role === "user");
    expect(user).toMatchObject({ text: "remember the milk" });
    const assistant = rows.find((row) => row.kind === "conversation" && row.role === "assistant");
    expect(assistant).toMatchObject({ text: "Noted: remember the milk", turnId });
    const fileChange = rows.find((row) => row.kind === "work" && row.workKind === "file-change");
    expect(fileChange).toMatchObject({ status: "completed", turnId });

    const notePath = join(harness.vaultDir, scriptedNotePath(threadId));
    expect(readFileSync(notePath, "utf8")).toContain("remember the milk");

    const head = await gitLogHead(harness.vaultDir);
    const [authorName, authorEmail, committerName, subject, ...trailerLines] = head.split("\n");
    expect(authorName).toBe("inteligir-agent");
    expect(authorEmail).toBe("agent@inteligir.local");
    // The committer stays the engine identity, so the machine that wrote the
    // commit remains legible next to the agent authorship.
    expect(committerName).toBe("inteligir");
    expect(subject).toBe("agent: vault update");
    expect(trailerLines.join("\n")).toContain(`Thread: ${threadId}`);
  });
});
