import type { GitEngine } from "../../vault/git-engine";
import type { CommitAuthor } from "../../vault/git-run";
import { parseAgentCommitTrailers } from "../../vault/turn-trailers";
import { createNotifierRecorder } from "../../vault/__tests__/notifier-recorder";
import { describe, expect, it } from "vitest";
import { beginAgentTurnWrites, createVaultPathResolver } from "../agent-commits";
import type { AgentTurnWritesArgs } from "../agent-commits";

interface RecordedCommit {
  paths: readonly string[];
  author: CommitAuthor;
  subject: string;
}

interface RecordingEngineOptions {
  // what the scoped commit answers: a reverted write stages nothing and lands no commit.
  commitLands?: boolean;
  checkpointFails?: boolean;
}

interface RecordingEngine {
  git: GitEngine;
  holds: number;
  releases: number;
  checkpoints: number;
  claims: string[][];
  scopedCommits: RecordedCommit[];
  wholeTreeCommits: number;
}

const recordingEngine = (options: RecordingEngineOptions = {}): RecordingEngine => {
  const claims: string[][] = [];
  const scopedCommits: RecordedCommit[] = [];
  const state = {
    checkpoints: 0,
    claims,
    holds: 0,
    releases: 0,
    scopedCommits,
    wholeTreeCommits: 0,
  };
  const git: GitEngine = {
    checkpointUnclaimed: async () => {
      state.checkpoints += 1;
      if (options.checkpointFails === true) {
        throw new Error("index.lock exists");
      }
      return await Promise.resolve(null);
    },
    claimedPaths: () => state.claims.flat(),
    currentRemote: async () => await Promise.resolve(null),
    commitNow: async () => {
      state.wholeTreeCommits += 1;
      return await Promise.resolve(null);
    },
    commitPaths: async (paths, author, subject) => {
      state.scopedCommits.push({ author, paths, subject });
      return await Promise.resolve(options.commitLands === false ? null : { files: paths.length });
    },
    deleted: async () => await Promise.resolve([]),
    dispose: async () => {
      await Promise.resolve();
    },
    history: async () => await Promise.resolve([]),
    holdCommits() {
      state.holds += 1;
      const claimed: string[] = [];
      state.claims.push(claimed);
      return {
        claim(paths) {
          claimed.push(...paths);
        },
        release() {
          state.releases += 1;
        },
      };
    },
    isSyncing() {
      return false;
    },
    revision: async () => await Promise.resolve(""),
    runExclusive: async (work) => await work(),
    scheduleCommit() {},
    startAutoSync() {},
    status: async () =>
      await Promise.resolve({
        externalSync: null,
        lastError: null,
        lastSyncAt: null,
        state: "no-remote",
      }),
    syncNow: async () =>
      await Promise.resolve({
        externalSync: null,
        lastError: null,
        lastSyncAt: null,
        state: "no-remote",
      }),
    turnCommits: async () => await Promise.resolve([]),
  };
  return {
    get checkpoints() {
      return state.checkpoints;
    },
    get claims() {
      return state.claims;
    },
    git,
    get holds() {
      return state.holds;
    },
    get releases() {
      return state.releases;
    },
    get scopedCommits() {
      return state.scopedCommits;
    },
    get wholeTreeCommits() {
      return state.wholeTreeCommits;
    },
  };
};

const turnArgs = (
  git: GitEngine,
  extra: Partial<AgentTurnWritesArgs> = {},
): AgentTurnWritesArgs => ({
  git,
  notifier: createNotifierRecorder(),
  threadId: "thr_1",
  turnId: "turn_1",
  ...extra,
});

describe("agent turn writes", () => {
  it("commits exactly the recorded write set, as the agent, naming its thread and turn", async () => {
    const engine = recordingEngine();
    const turn = beginAgentTurnWrites(turnArgs(engine.git));
    await turn.ready;
    turn.recordPaths(["a.md"]);
    turn.recordPaths(["b.md", "a.md"]);
    await turn.finish();

    expect(engine.scopedCommits).toHaveLength(1);
    expect(engine.scopedCommits[0]?.paths).toEqual(["a.md", "b.md"]);
    expect(engine.scopedCommits[0]?.author).toEqual({
      email: "agent@inteligir.local",
      name: "inteligir-agent",
    });
    expect(parseAgentCommitTrailers(engine.scopedCommits[0]?.subject ?? "")).toEqual({
      kind: "turn",
      threadId: "thr_1",
      turnId: "turn_1",
    });
    expect(engine.releases).toBe(1);
  });

  it("checkpoints before the provider may write, and claims what the turn reports", async () => {
    const engine = recordingEngine();
    const turn = beginAgentTurnWrites(turnArgs(engine.git));
    await turn.ready;
    expect(engine.checkpoints).toBe(1);
    turn.recordPaths(["a.md"]);
    turn.recordPaths(["b.md"]);
    expect(engine.git.claimedPaths()).toEqual(["a.md", "b.md"]);
    await turn.finish();
  });

  it("resolves ready when the checkpoint fails, and says why", async () => {
    const engine = recordingEngine({ checkpointFails: true });
    const errors: string[] = [];
    const turn = beginAgentTurnWrites(
      turnArgs(engine.git, {
        onError: (message) => {
          errors.push(message);
        },
      }),
    );
    await expect(turn.ready).resolves.toBeUndefined();
    expect(errors).toEqual(["the checkpoint before turn turn_1 failed: index.lock exists"]);
    turn.recordPaths(["a.md"]);
    await turn.finish();
    expect(engine.scopedCommits).toHaveLength(1);
  });

  it("announces the turn's changes once its commit lands, and only then", async () => {
    const notifier = createNotifierRecorder();
    const landed = recordingEngine();
    const turn = beginAgentTurnWrites(turnArgs(landed.git, { notifier }));
    await turn.ready;
    turn.recordPaths(["a.md"]);
    expect(notifier.threadChanges).toEqual([]);
    await turn.finish();
    await turn.finish();
    expect(notifier.threadChanges).toEqual([{ changes: ["changes-committed"], threadId: "thr_1" }]);

    notifier.reset();
    const empty = beginAgentTurnWrites(turnArgs(recordingEngine().git, { notifier }));
    await empty.ready;
    await empty.finish();
    const reverted = beginAgentTurnWrites(
      turnArgs(recordingEngine({ commitLands: false }).git, { notifier }),
    );
    await reverted.ready;
    reverted.recordPaths(["a.md"]);
    await reverted.finish();
    expect(notifier.threadChanges).toEqual([]);
  });

  it("makes no commit when the turn wrote nothing, and still releases", async () => {
    const engine = recordingEngine();
    const turn = beginAgentTurnWrites(turnArgs(engine.git));
    await turn.ready;
    await turn.finish();
    expect(engine.scopedCommits).toEqual([]);
    expect(engine.holds).toBe(1);
    expect(engine.releases).toBe(1);
  });

  it("releases once however many times finish is called", async () => {
    const engine = recordingEngine();
    const turn = beginAgentTurnWrites(turnArgs(engine.git));
    turn.recordPaths(["a.md"]);
    await turn.finish();
    await turn.finish();
    expect(engine.scopedCommits).toHaveLength(1);
    expect(engine.releases).toBe(1);
  });

  it("does not commit the whole tree — the checkpoint is the engine's, less the claims", async () => {
    const engine = recordingEngine();
    const turn = beginAgentTurnWrites(turnArgs(engine.git));
    await turn.ready;
    await turn.finish();
    expect(engine.wholeTreeCommits).toBe(0);
  });
});

describe("createVaultPathResolver", () => {
  it("keeps vault-relative paths and refuses an escape", () => {
    const resolve = createVaultPathResolver("/tmp/does-not-exist-vault");
    expect(resolve("notes/a.md")).toBe("notes/a.md");
    expect(resolve("../outside.md")).toBeNull();
    expect(resolve("/elsewhere/a.md")).toBeNull();
  });
});
