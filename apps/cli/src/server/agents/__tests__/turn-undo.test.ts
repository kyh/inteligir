// the turns here commit through the same write set the runtime manager opens per turn, over the
// composed server's own engine and vault; only the provider is the test's.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isDefinedError, safe } from "@orpc/client";
import { describe, expect, it } from "vitest";
import { bootThreadHarness } from "../../__tests__/boot-app";
import type { ThreadHarness } from "../../__tests__/boot-app";
import { beginAgentTurnWrites } from "../agent-commits";
import type { AgentTurnWrites } from "../agent-commits";
import { undoTurnChanges } from "../turn-changes";
import { awaitThreadStatus, createThread, sendMessage } from "./agent-test-harness";

const doc = (...lines: string[]): string => `${lines.join("\n")}\n`;

interface OpenTurn {
  threadId: string;
  turnId: string;
  writes: AgentTurnWrites;
}

const startTurn = async (harness: ThreadHarness, threadId: string): Promise<OpenTurn> => {
  const turnId = await sendMessage(harness.client, threadId, "edit my notes");
  const writes = beginAgentTurnWrites({
    git: harness.vault.git,
    notifier: harness.bus,
    threadId,
    turnId,
  });
  await writes.ready;
  return { threadId, turnId, writes };
};

const agentWrites = async (
  harness: ThreadHarness,
  turn: OpenTurn,
  notePath: string,
  content: string,
): Promise<void> => {
  const written = await harness.vault.service.write(notePath, content);
  turn.writes.recordPaths([written.path]);
};

const settle = async (harness: ThreadHarness, turn: OpenTurn): Promise<void> => {
  await turn.writes.finish();
  harness.driver.completeTurn(turn.threadId, turn.turnId, "completed");
  await awaitThreadStatus(harness.client, turn.threadId, "idle");
};

const boot = async (seed: Record<string, string> = {}): Promise<ThreadHarness> => {
  const harness = await bootThreadHarness({ mode: "manual" });
  for (const [notePath, content] of Object.entries(seed)) {
    await harness.vault.service.write(notePath, content);
  }
  await harness.vault.git.commitNow();
  return harness;
};

const onDisk = (harness: ThreadHarness, notePath: string): string | null => {
  const absolute = path.join(harness.vaultDir, notePath);
  return existsSync(absolute) ? readFileSync(absolute, "utf-8") : null;
};

describe("undoing a turn", () => {
  it("reverts every note the turn changed and keeps a line the user added since", async () => {
    const harness = await boot({
      "a.md": doc("# A", "", "first", "", "tail"),
      "b.md": doc("# B", "", "one"),
    });
    const threadId = await createThread(harness.client);
    const turn = await startTurn(harness, threadId);
    await agentWrites(harness, turn, "a.md", doc("# A", "", "second", "", "tail"));
    await agentWrites(harness, turn, "b.md", doc("# B", "", "two"));
    await settle(harness, turn);
    await harness.vault.service.write("a.md", doc("# A", "", "second", "", "tail", "mine"));

    expect(await harness.client.threads.undoTurn({ threadId, turnId: turn.turnId })).toEqual({
      kept: [],
      reverted: ["a.md", "b.md"],
    });
    expect(onDisk(harness, "a.md")).toBe(doc("# A", "", "first", "", "tail", "mine"));
    expect(onDisk(harness, "b.md")).toBe(doc("# B", "", "one"));
    const { content } = await harness.vault.service.read("a.md");
    expect(content).toBe(doc("# A", "", "first", "", "tail", "mine"));

    const commits = await harness.vault.git.turnCommits(threadId, 0);
    expect(commits.at(-1)?.trailers).toEqual({
      kind: "undo",
      threadId,
      undoesTurnId: turn.turnId,
    });
    const [latest] = await harness.vault.git.history("b.md", { limit: 1, skip: 0 });
    expect(latest).toMatchObject({ authorName: "inteligir", subject: "vault: undo agent changes" });
    expect(await harness.client.threads.turnChanges({ threadId })).toEqual({
      turns: [{ paths: ["a.md", "b.md"], state: "undone", turnId: turn.turnId }],
    });
  });

  it("keeps a note a write raced, with the racer's bytes on disk", async () => {
    const harness = await boot({ "a.md": doc("# A", "", "first") });
    const threadId = await createThread(harness.client);
    const turn = await startTurn(harness, threadId);
    await agentWrites(harness, turn, "a.md", doc("# A", "", "second"));
    await settle(harness, turn);

    const { service } = harness.vault;
    const racer = doc("# A", "", "second", "", "typed while the undo read");
    const outcome = await undoTurnChanges({
      db: harness.db,
      git: harness.vault.git,
      notifier: harness.bus,
      service: {
        ...service,
        read: async (notePath) => {
          const read = await service.read(notePath);
          await service.write(notePath, racer);
          return read;
        },
      },
      threadId,
      turnId: turn.turnId,
    });

    expect(outcome).toEqual({
      changes: { kept: [{ path: "a.md", reason: "edited-since" }], reverted: [] },
      kind: "undone",
    });
    expect(onDisk(harness, "a.md")).toBe(racer);
  });

  it("leaves a note a running turn has claimed untouched", async () => {
    const harness = await boot({ "a.md": doc("# A", "", "first") });
    const threadId = await createThread(harness.client);
    const turn = await startTurn(harness, threadId);
    await agentWrites(harness, turn, "a.md", doc("# A", "", "second"));
    await settle(harness, turn);

    const other = await startTurn(harness, await createThread(harness.client));
    await agentWrites(harness, other, "a.md", doc("# A", "", "third"));

    expect(await harness.client.threads.undoTurn({ threadId, turnId: turn.turnId })).toEqual({
      kept: [{ path: "a.md", reason: "busy" }],
      reverted: [],
    });
    expect(onDisk(harness, "a.md")).toBe(doc("# A", "", "third"));
    await settle(harness, other);
  });

  it("brings back a note the turn deleted and removes the one it created", async () => {
    const harness = await boot({ "gone.md": doc("# Gone", "", "kept bytes") });
    const threadId = await createThread(harness.client);
    const turn = await startTurn(harness, threadId);
    await harness.vault.service.remove("gone.md");
    turn.writes.recordPaths(["gone.md"]);
    await agentWrites(harness, turn, "made.md", doc("# Made"));
    await settle(harness, turn);

    expect(await harness.client.threads.undoTurn({ threadId, turnId: turn.turnId })).toEqual({
      kept: [],
      reverted: ["gone.md", "made.md"],
    });
    expect(onDisk(harness, "gone.md")).toBe(doc("# Gone", "", "kept bytes"));
    expect(onDisk(harness, "made.md")).toBeNull();
  });

  it("refuses a turn already undone, a turn still running and one it holds no change of", async () => {
    const harness = await boot({ "a.md": doc("# A", "", "first") });
    const threadId = await createThread(harness.client);
    const turn = await startTurn(harness, threadId);
    await agentWrites(harness, turn, "a.md", doc("# A", "", "second"));
    await settle(harness, turn);
    await harness.client.threads.undoTurn({ threadId, turnId: turn.turnId });

    const [again] = await safe(harness.client.threads.undoTurn({ threadId, turnId: turn.turnId }));
    expect(isDefinedError(again) && again.code).toBe("CONFLICT");

    const running = await startTurn(harness, threadId);
    await agentWrites(harness, running, "a.md", doc("# A", "", "third"));
    const [live] = await safe(
      harness.client.threads.undoTurn({ threadId, turnId: running.turnId }),
    );
    expect(isDefinedError(live) && live.code).toBe("CONFLICT");
    await settle(harness, running);

    const quiet = await startTurn(harness, threadId);
    await settle(harness, quiet);
    const [unrecorded] = await safe(
      harness.client.threads.undoTurn({ threadId, turnId: quiet.turnId }),
    );
    expect(isDefinedError(unrecorded) && unrecorded.code).toBe("NOT_FOUND");

    const [noThread] = await safe(
      harness.client.threads.undoTurn({ threadId: "thr_missing", turnId: turn.turnId }),
    );
    expect(isDefinedError(noThread) && noThread.code).toBe("NOT_FOUND");
  });
});
