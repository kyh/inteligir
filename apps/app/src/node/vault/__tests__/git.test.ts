import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGitEngine, ensureVaultRepo, runGit, type GitEngine } from "../git";
import { hermeticGitEnv } from "./git-test-env";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup();
  }
});

const env = hermeticGitEnv();

function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function makeBareRemote(): Promise<string> {
  const dir = scratchDir("inteligir-git-remote-");
  await runGit(dir, ["init", "--bare", "-b", "main"], { env });
  return dir;
}

async function makeEngine(args: {
  remoteUrl: string | null;
  quietMs?: number;
  maxWaitMs?: number;
}): Promise<{ root: string; engine: GitEngine }> {
  const root = scratchDir("inteligir-git-vault-");
  await ensureVaultRepo({ root, env });
  const engine = createGitEngine({
    root,
    remoteUrl: args.remoteUrl,
    env,
    ...(args.quietMs === undefined ? {} : { quietMs: args.quietMs }),
    ...(args.maxWaitMs === undefined ? {} : { maxWaitMs: args.maxWaitMs }),
  });
  cleanups.push(() => engine.dispose());
  return { root, engine };
}

async function commitCount(root: string): Promise<number> {
  const { stdout } = await runGit(root, ["rev-list", "--count", "HEAD"], { env });
  return Number.parseInt(stdout.trim(), 10);
}

async function lastMessage(root: string): Promise<string> {
  const { stdout } = await runGit(root, ["log", "-1", "--format=%s"], { env });
  return stdout.trim();
}

async function expectCleanRepo(root: string): Promise<void> {
  const { stdout } = await runGit(root, ["status", "--porcelain"], { env });
  expect(stdout).toBe("");
  expect(existsSync(join(root, ".git", "rebase-merge"))).toBe(false);
  expect(existsSync(join(root, ".git", "rebase-apply"))).toBe(false);
  await runGit(root, ["fsck", "--no-progress"], { env });
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("ensureVaultRepo", () => {
  it("creates, inits and seeds a missing vault, and leaves HEAD born", async () => {
    const parent = scratchDir("inteligir-git-boot-");
    const root = join(parent, "vault");
    const { created } = await ensureVaultRepo({
      root,
      env,
      seed: (dir) => writeFile(join(dir, "Welcome.md"), "hello\n", "utf8"),
    });
    expect(created).toBe(true);
    expect(await readFile(join(root, "Welcome.md"), "utf8")).toBe("hello\n");
    expect(await commitCount(root)).toBe(1);
    await expectCleanRepo(root);

    // Idempotent, and never re-seeds an existing vault.
    const again = await ensureVaultRepo({ root, env });
    expect(again.created).toBe(false);
    expect(await commitCount(root)).toBe(1);
  });
});

describe("auto-commit", () => {
  it("lands a burst of writes as ONE commit with the file count", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null, quietMs: 50, maxWaitMs: 2_000 });
    const before = await commitCount(root);

    for (const name of ["a.md", "b.md", "c.md"]) {
      await writeFile(join(root, name), `# ${name}\n`, "utf8");
      engine.scheduleCommit();
    }

    await waitFor(async () => (await commitCount(root)) === before + 1);
    expect(await lastMessage(root)).toBe("vault: update 3 files");
    // The quiet window keeps draining: no second commit follows.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await commitCount(root)).toBe(before + 1);
    await expectCleanRepo(root);
  });

  it("commitNow is a no-op on a clean tree and takes the author seam", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null });
    expect(await engine.commitNow()).toBeNull();

    await writeFile(join(root, "agent.md"), "written by an agent\n", "utf8");
    const committed = await engine.commitNow({ name: "Agent Smith", email: "agent@inteligir" });
    expect(committed).toEqual({ files: 1 });
    const { stdout } = await runGit(root, ["log", "-1", "--format=%an <%ae>|%cn"], { env });
    expect(stdout.trim()).toBe("Agent Smith <agent@inteligir>|inteligir");
  });

  it("interleaved turns attribute separately: each commits ITS write set only", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null, quietMs: 50, maxWaitMs: 500 });
    const before = await commitCount(root);

    // Two overlapping turns hold commits; a user edit rides neither.
    const releaseA = engine.holdCommits();
    const releaseB = engine.holdCommits();
    await writeFile(join(root, "a.md"), "turn A\n", "utf8");
    await writeFile(join(root, "b.md"), "turn B\n", "utf8");
    await writeFile(join(root, "user.md"), "user edit\n", "utf8");
    engine.scheduleCommit();

    const committedA = await engine.commitPaths(
      ["a.md"],
      { name: "agent-a", email: "a@inteligir" },
      "agent: vault update\n\nThread: thr_a",
    );
    expect(committedA).toEqual({ files: 1 });
    releaseA();
    let files = (await runGit(root, ["show", "--name-only", "--format=%an", "HEAD"], { env }))
      .stdout;
    expect(files).toContain("agent-a");
    expect(files).toContain("a.md");
    expect(files).not.toContain("b.md");
    expect(files).not.toContain("user.md");

    const committedB = await engine.commitPaths(
      ["b.md"],
      { name: "agent-b", email: "b@inteligir" },
      "agent: vault update\n\nThread: thr_b",
    );
    expect(committedB).toEqual({ files: 1 });
    releaseB();
    files = (await runGit(root, ["show", "--name-only", "--format=%an", "HEAD"], { env })).stdout;
    expect(files).toContain("agent-b");
    expect(files).toContain("b.md");
    expect(files).not.toContain("user.md");

    // The file no turn claimed lands in the re-armed debounce commit, as the
    // engine identity.
    await waitFor(async () => (await commitCount(root)) === before + 3);
    files = (await runGit(root, ["show", "--name-only", "--format=%an", "HEAD"], { env })).stdout;
    expect(files).toContain("inteligir");
    expect(files).toContain("user.md");
    await expectCleanRepo(root);

    // A path that is no longer dirty commits nothing.
    expect(
      await engine.commitPaths(["a.md"], { name: "agent-a", email: "a@inteligir" }, "noop"),
    ).toBeNull();
  });

  it("a commit hold defers the debounce flush; release re-arms it", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null, quietMs: 50, maxWaitMs: 500 });
    const before = await commitCount(root);

    const release = engine.holdCommits();
    await writeFile(join(root, "mid-turn.md"), "agent writing\n", "utf8");
    engine.scheduleCommit();
    // Past the quiet window and the max wait: still no engine commit.
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(await commitCount(root)).toBe(before);

    // The turn's own commit runs under the hold — that IS the release path.
    const committed = await engine.commitNow(
      { name: "inteligir-agent", email: "agent@inteligir.local" },
      "agent: vault update\n\nThread: thr_test",
    );
    expect(committed).toEqual({ files: 1 });
    release();

    // The re-armed flush finds a clean tree: no second commit.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await commitCount(root)).toBe(before + 1);
    expect(await lastMessage(root)).toBe("agent: vault update");
    const { stdout } = await runGit(root, ["log", "-1", "--format=%(trailers:key=Thread)"], {
      env,
    });
    expect(stdout.trim()).toBe("Thread: thr_test");
    await expectCleanRepo(root);
  });
});

describe("sync", () => {
  it("stays idle with no remote", async () => {
    const { engine } = await makeEngine({ remoteUrl: null });
    const status = await engine.syncNow();
    expect(status.state).toBe("no-remote");
  });

  it("round-trips a change through two clones of one bare remote", async () => {
    const remote = await makeBareRemote();
    const a = await makeEngine({ remoteUrl: remote });
    const b = await makeEngine({ remoteUrl: remote });

    // First contact: A creates the remote branch, B rebases onto it.
    expect((await a.engine.syncNow()).state).toBe("clean");
    expect((await b.engine.syncNow()).state).toBe("clean");
    expect((await a.engine.syncNow()).state).toBe("clean");

    await writeFile(join(a.root, "shared.md"), "written on A\n", "utf8");
    expect(await a.engine.commitNow()).toEqual({ files: 1 });
    expect((await a.engine.status()).state).toBe("dirty");
    expect((await a.engine.syncNow()).state).toBe("clean");

    expect((await b.engine.syncNow()).state).toBe("clean");
    expect(await readFile(join(b.root, "shared.md"), "utf8")).toBe("written on A\n");

    await writeFile(join(b.root, "shared.md"), "edited on B\n", "utf8");
    await b.engine.commitNow();
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(await readFile(join(a.root, "shared.md"), "utf8")).toBe("edited on B\n");

    await expectCleanRepo(a.root);
    await expectCleanRepo(b.root);
  });

  it("surfaces diverging edits as a typed conflict and leaves the repo clean", async () => {
    const remote = await makeBareRemote();
    const a = await makeEngine({ remoteUrl: remote });
    const b = await makeEngine({ remoteUrl: remote });
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();

    await writeFile(join(a.root, "shared.md"), "from A\n", "utf8");
    await a.engine.commitNow();
    await a.engine.syncNow();

    await writeFile(join(b.root, "shared.md"), "from B\n", "utf8");
    await b.engine.commitNow();
    const status = await b.engine.syncNow();

    expect(status.state).toBe("conflict");
    if (status.state !== "conflict") {
      throw new Error("unreachable");
    }
    expect(status.conflict.files).toEqual(["shared.md"]);
    expect(status.conflict.ours.commits).toBeGreaterThanOrEqual(1);
    expect(status.conflict.theirs.commits).toBeGreaterThanOrEqual(1);

    // The refused rebase was aborted: porcelain empty, no rebase in progress,
    // fsck clean, and B's own edit is still its HEAD content.
    await expectCleanRepo(b.root);
    expect(await readFile(join(b.root, "shared.md"), "utf8")).toBe("from B\n");

    // The conflict is sticky across status reads until a sync succeeds.
    expect((await b.engine.status()).state).toBe("conflict");
  });

  it("says a hold is holding it instead of answering as if a pass ran", async () => {
    const remote = await makeBareRemote();
    const { engine } = await makeEngine({ remoteUrl: remote });
    expect((await engine.syncNow()).state).toBe("clean");

    const release = engine.holdCommits();
    // No pass may start under a hold — the state names WHY rather than
    // reporting the clean tree a sync would have left behind.
    expect((await engine.syncNow()).state).toBe("held");
    expect((await engine.status()).state).toBe("held");

    release();
    expect((await engine.syncNow()).state).toBe("clean");
  });

  it("says offline rather than clean when the remote cannot be reached", async () => {
    // A vault with nothing local to push: `unpushed` is measured against the
    // remote-tracking ref, so a stale one would answer "clean" — a sync this
    // engine never performed.
    const { engine } = await makeEngine({ remoteUrl: join(await makeBareRemote(), "gone") });
    const status = await engine.syncNow();
    expect(status.state).toBe("offline");
    expect(status.lastError).not.toBeNull();
    // Sticky: a status read after the failed pass makes the same claim.
    expect((await engine.status()).state).toBe("offline");
  });

  it("clears offline once a pass reaches the remote again", async () => {
    const parent = scratchDir("inteligir-git-late-remote-");
    const remote = join(parent, "late.git");
    const { engine } = await makeEngine({ remoteUrl: remote });
    expect((await engine.syncNow()).state).toBe("offline");

    await runGit(parent, ["init", "--bare", "-b", "main", "late.git"], { env });
    const recovered = await engine.syncNow();
    expect(recovered.state).toBe("clean");
    expect(recovered.lastError).toBeNull();
  });
});

describe("runGit", () => {
  /** What git itself sees in its environment, read back through a shell alias. */
  async function gitEnvValue(root: string, name: string): Promise<string> {
    const { stdout } = await runGit(
      root,
      ["-c", `alias.dumpenv=!printenv ${name} || true`, "dumpenv"],
      { env },
    );
    return stdout.trim();
  }

  it("never lets git ask this process a question", async () => {
    // A prompt on an unreachable or auth-requiring remote does not fail, it
    // BLOCKS — under the repo lock, so every vault write stalls behind it
    // until the call's timeout.
    const root = scratchDir("inteligir-git-env-");
    await ensureVaultRepo({ root, env });
    expect(await gitEnvValue(root, "GIT_TERMINAL_PROMPT")).toBe("0");
    expect(await gitEnvValue(root, "GIT_SSH_COMMAND")).toBe("ssh -o BatchMode=yes");
  });

  it("leaves a caller's own GIT_SSH_COMMAND alone", async () => {
    // Someone who configured how ssh runs has made a choice; overriding it
    // would break the setups that exist to make these fetches work at all.
    const root = scratchDir("inteligir-git-ssh-");
    await ensureVaultRepo({ root, env });
    const { stdout } = await runGit(
      root,
      ["-c", "alias.dumpenv=!printenv GIT_SSH_COMMAND || true", "dumpenv"],
      { env: { ...env, GIT_SSH_COMMAND: "ssh -F /custom/config" } },
    );
    expect(stdout.trim()).toBe("ssh -F /custom/config");
  });
});
