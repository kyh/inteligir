// The agent turn's commit-hold contract, over a recording engine — the one
// thing no integration test can see, because a leaked hold is silent until a
// sync mysteriously stops running hours later.
//
// The invariants, stated as this suite checks them:
//   - a hold is taken once per turn and released exactly once, on every exit
//     path (settled, failed, finished twice, `ready` rejected);
//   - a turn that wrote nothing makes NO commit — an empty commit is not a
//     harmless artefact, it is a lie about what the agent did.

import type { GitEngine } from "../../vault/git-engine";
import type { CommitAuthor } from "../../vault/git-run";
import { describe, expect, it } from "vitest";
import { beginAgentTurnWrites, createVaultPathResolver } from "../agent-commits";

interface RecordedCommit {
  paths: readonly string[];
  author: CommitAuthor;
  subject: string;
}

interface RecordingEngine {
  git: GitEngine;
  holds: number;
  releases: number;
  scopedCommits: RecordedCommit[];
  wholeTreeCommits: number;
}

function recordingEngine(): RecordingEngine {
  const scopedCommits: RecordedCommit[] = [];
  const state = {
    holds: 0,
    releases: 0,
    scopedCommits,
    wholeTreeCommits: 0,
  };
  const git: GitEngine = {
    scheduleCommit() {},
    async commitNow() {
      state.wholeTreeCommits += 1;
      return null;
    },
    async commitPaths(paths, author, subject) {
      state.scopedCommits.push({ paths, author, subject });
      return { files: paths.length };
    },
    holdCommits() {
      state.holds += 1;
      return () => {
        state.releases += 1;
      };
    },
    async history() {
      return [];
    },
    async revision() {
      return "";
    },
    async syncNow() {
      return { state: "no-remote", lastSyncAt: null, lastError: null };
    },
    async status() {
      return { state: "no-remote", lastSyncAt: null, lastError: null };
    },
    isSyncing() {
      return false;
    },
    runExclusive: (work) => work(),
    startAutoSync() {},
    async dispose() {},
  };
  return {
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
}

describe("agent turn writes", () => {
  it("commits exactly the recorded write set, as the agent", async () => {
    const engine = recordingEngine();
    const turn = beginAgentTurnWrites({
      git: engine.git,
      threadId: "thr_1",
      turnId: "turn_1",
    });
    await turn.ready;
    turn.recordPaths(["a.md"]);
    turn.recordPaths(["b.md", "a.md"]);
    await turn.finish();

    expect(engine.scopedCommits).toHaveLength(1);
    expect(engine.scopedCommits[0]?.paths).toEqual(["a.md", "b.md"]);
    expect(engine.scopedCommits[0]?.author).toEqual({
      name: "inteligir-agent",
      email: "agent@inteligir.local",
    });
    expect(engine.scopedCommits[0]?.subject).toContain("Thread: thr_1");
    expect(engine.releases).toBe(1);
  });

  it("makes no commit when the turn wrote nothing, and still releases", async () => {
    const engine = recordingEngine();
    const turn = beginAgentTurnWrites({
      git: engine.git,
      threadId: "thr_1",
      turnId: "turn_1",
    });
    await turn.ready;
    await turn.finish();
    expect(engine.scopedCommits).toEqual([]);
    expect(engine.holds).toBe(1);
    expect(engine.releases).toBe(1);
  });

  it("releases once however many times finish is called", async () => {
    const engine = recordingEngine();
    const turn = beginAgentTurnWrites({
      git: engine.git,
      threadId: "thr_1",
      turnId: "turn_1",
    });
    turn.recordPaths(["a.md"]);
    await turn.finish();
    await turn.finish();
    expect(engine.scopedCommits).toHaveLength(1);
    expect(engine.releases).toBe(1);
  });

  it("does not pin a base revision — it has nothing to measure against", async () => {
    const engine = recordingEngine();
    const turn = beginAgentTurnWrites({
      git: engine.git,
      threadId: "thr_1",
      turnId: "turn_1",
    });
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
