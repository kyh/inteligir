import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAgentDriver } from "../agent-driver";
import { scriptedNotePath } from "../scripted-driver";
import { bootTestApp } from "../../__tests__/boot-app";
import {
  awaitThreadStatus,
  createThread,
  fakeSessionFacts,
  fetchTimelineRows,
  flattenTimelineRows,
  sendMessage,
} from "./agent-test-harness";
import { hermeticGitEnv } from "../../vault/__tests__/git-test-env";

const gitLogHead = (vaultDir: string): string =>
  execFileSync("git", ["log", "-1", "--format=%an%n%ae%n%cn%n%s%n%(trailers)"], {
    cwd: vaultDir,
    encoding: "utf-8",
    env: { ...process.env, ...hermeticGitEnv() },
  });

describe("the scripted driver over real HTTP", () => {
  it("runs the deterministic turn: timeline, vault file, agent-attributed commit", async () => {
    const harness = await bootTestApp({
      agent: { detail: null, mode: "scripted", runtime: "scripted" },
      makeDriver: ({ db, bus, vault, vaultDir }) => {
        const resolved = resolveAgentDriver({
          config: {
            agent: "scripted",
            agentModel: null,
            vaultDir,
          },
          db,
          mcpServers: () => [],
          notifier: bus,
          sessionFacts: () => fakeSessionFacts(),
          vault,
        });
        expect(resolved.status).toEqual({ detail: null, mode: "scripted", runtime: "scripted" });
        return { createTurnDriver: resolved.createTurnDriver, dispose: resolved.dispose };
      },
    });

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
    expect(committerName).toBe("inteligir");
    expect(subject).toBe("agent: vault update");
    expect(trailerLines.join("\n")).toContain(`Thread: ${threadId}`);
  });
});
