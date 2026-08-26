import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createGitEngine,
  ensureVaultRepo,
  runGit,
  type GitEngine,
  type GitEngineArgs,
} from "../git";
import { boundAddressSchema } from "../../__tests__/bound-address";
import { hermeticGitEnv } from "./git-test-env";
import { makeTempDir } from "../../__tests__/temp-dir";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup();
  }
});

const env = hermeticGitEnv();

function scratchDir(prefix: string): string {
  const dir = makeTempDir(prefix);
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
}): Promise<{ root: string; engine: GitEngine; statusChanges: () => number }> {
  const root = scratchDir("inteligir-git-vault-");
  await ensureVaultRepo({ root, env });
  let statusChanges = 0;
  const engineArgs: GitEngineArgs = {
    root,
    remote: () => (args.remoteUrl === null ? null : { url: args.remoteUrl, source: "explicit" }),
    env,
    onStatusChanged: () => {
      statusChanges += 1;
    },
  };
  if (args.quietMs !== undefined) engineArgs.quietMs = args.quietMs;
  if (args.maxWaitMs !== undefined) engineArgs.maxWaitMs = args.maxWaitMs;
  const engine = createGitEngine(engineArgs);
  cleanups.push(() => engine.dispose());
  return { root, engine, statusChanges: () => statusChanges };
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

describe("what a scheduled commit costs", () => {
  it("stages the union of the paths it was told about, and nothing else", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null, quietMs: 50, maxWaitMs: 2_000 });
    const before = await commitCount(root);

    // Two saves the app announced, and one file it never heard about.
    await writeFile(join(root, "told-a.md"), "a\n", "utf8");
    engine.scheduleCommit(["told-a.md"]);
    await writeFile(join(root, "told-b.md"), "b\n", "utf8");
    engine.scheduleCommit(["told-b.md"]);
    await writeFile(join(root, "untold.md"), "c\n", "utf8");

    await waitFor(async () => (await commitCount(root)) === before + 1);
    const { stdout } = await runGit(root, ["show", "--name-only", "--format=", "HEAD"], { env });
    expect(stdout.trim().split("\n").toSorted()).toEqual(["told-a.md", "told-b.md"]);
    // A whole-tree `status` + `add -A` per quiet window is what this replaces;
    // the sweep still exists for the callers that mean it.
    expect(await engine.commitNow()).toEqual({ files: 1 });
  });

  it("falls back to the whole tree when one scheduler named no paths", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null, quietMs: 50, maxWaitMs: 2_000 });
    const before = await commitCount(root);

    await writeFile(join(root, "told.md"), "a\n", "utf8");
    engine.scheduleCommit(["told.md"]);
    await writeFile(join(root, "untold.md"), "b\n", "utf8");
    // The boot sweep and the post-sync drain both mean "whatever is dirty".
    engine.scheduleCommit();

    await waitFor(async () => (await commitCount(root)) === before + 1);
    expect(await engine.commitNow()).toBeNull();
    await expectCleanRepo(root);
  });

  it("announces no status change: a commit is not a transition", async () => {
    const { root, engine, statusChanges } = await makeEngine({
      remoteUrl: null,
      quietMs: 50,
      maxWaitMs: 2_000,
    });
    const before = await commitCount(root);
    await writeFile(join(root, "saved.md"), "a\n", "utf8");
    engine.scheduleCommit(["saved.md"]);
    await waitFor(async () => (await commitCount(root)) === before + 1);

    // Every listener answers this by re-fetching the status, and every fetch
    // is a `git status --porcelain` plus a `rev-list` under the repo lock —
    // to be told the same word the commit already implied.
    expect(statusChanges()).toBe(0);
    await engine.commitNow();
    expect(statusChanges()).toBe(0);
  });
});

describe("auto-commit", () => {
  it("lands a burst of writes as ONE commit with the file count", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null, quietMs: 50, maxWaitMs: 2_000 });
    const before = await commitCount(root);

    for (const name of ["a.md", "b.md", "c.md"]) {
      await writeFile(join(root, name), `# ${name}\n`, "utf8");
      engine.scheduleCommit([name]);
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

describe("the clone path", () => {
  it("clones a populated remote instead of init+seed — a second device joins the vault", async () => {
    const remote = await makeBareRemote();
    const a = await makeEngine({ remoteUrl: remote });
    await writeFile(join(a.root, "note.md"), "# from A\n");
    await a.engine.commitNow();
    expect((await a.engine.syncNow()).state).toBe("clean");

    const bRoot = join(scratchDir("inteligir-git-clone-"), "vault");
    let seeded = false;
    const { created, cloned } = await ensureVaultRepo({
      root: bRoot,
      remote: { url: remote, source: "explicit" },
      seed: async () => {
        seeded = true;
      },
      env,
    });
    expect(created).toBe(true);
    expect(cloned).toBe(true);
    expect(seeded).toBe(false);
    expect(await readFile(join(bRoot, "note.md"), "utf8")).toBe("# from A\n");
  });

  it("seeds only the HOSTED missing-repo miss; an explicit remote's miss boots empty", async () => {
    // GitHub-style hosts answer 404 for a private repo the credential cannot
    // see, so an explicit remote's "not found" must not plant a seed beside
    // a vault that may exist.
    const bRoot = join(scratchDir("inteligir-git-clone-miss-"), "vault");
    let seeded = false;
    const { created, cloned } = await ensureVaultRepo({
      root: bRoot,
      remote: { url: join(scratchDir("inteligir-git-nowhere-"), "gone.git"), source: "explicit" },
      seed: async () => {
        seeded = true;
      },
      env,
    });
    expect(created).toBe(true);
    expect(cloned).toBe(false);
    expect(seeded).toBe(false);
    expect(existsSync(join(bRoot, ".git"))).toBe(true);

    const pairedRoot = join(scratchDir("inteligir-git-clone-miss-paired-"), "vault");
    let pairedSeeded = false;
    const paired = await ensureVaultRepo({
      root: pairedRoot,
      remote: {
        url: join(scratchDir("inteligir-git-nowhere-2-"), "gone.git"),
        source: "paired",
        account: "user-a",
      },
      seed: async () => {
        pairedSeeded = true;
      },
      env,
    });
    expect(paired.cloned).toBe(false);
    expect(pairedSeeded).toBe(true);
  });
});

describe("the cross-account fence", () => {
  it("refuses a pass when the vault last synced with a different account", async () => {
    const remote = await makeBareRemote();
    const root = scratchDir("inteligir-git-fence-");
    await ensureVaultRepo({ root, env });
    let account = "user-a";
    const engine = createGitEngine({
      root,
      remote: () => ({ url: remote, source: "paired", account }),
      env,
    });
    cleanups.push(() => engine.dispose());

    await writeFile(join(root, "note.md"), "# a\n");
    await engine.commitNow();
    expect((await engine.syncNow()).state).toBe("clean");
    // The first paired push pinned the marker.
    const marker = await runGit(root, ["config", "--get", "inteligir.account"], { env });
    expect(marker.stdout.trim()).toBe("user-a");

    const pushedCount = Number(
      (await runGit(remote, ["rev-list", "--count", "main"], { env })).stdout.trim(),
    );
    account = "user-b";
    const status = await engine.syncNow();
    expect(status.state).toBe("account-mismatch");
    // Nothing crossed the wire for the wrong account.
    expect(
      Number((await runGit(remote, ["rev-list", "--count", "main"], { env })).stdout.trim()),
    ).toBe(pushedCount);

    // Pairing back to the marker's own account syncs again.
    account = "user-a";
    expect((await engine.syncNow()).state).toBe("clean");
  });
});

describe("a refused credential", () => {
  it("surfaces as `unauthorized`, not `offline`", async () => {
    // The fixes are opposite: offline heals on its own, while a revoked
    // device fails every retry the same way until the user re-pairs.
    const server = createServer((_request, response) => {
      response.writeHead(401, { "www-authenticate": 'Basic realm="test"' });
      response.end("auth required\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const { port } = boundAddressSchema.parse(server.address());

    const { engine } = await makeEngine({
      remoteUrl: `http://127.0.0.1:${String(port)}/vault.git`,
    });
    const status = await engine.syncNow();
    expect(status.state).toBe("unauthorized");
  });
});

describe("clone failure classes", () => {
  it("an unreachable remote boots EMPTY — the seed waits for a remote that answered", async () => {
    // A populated remote that merely could not answer must not gain a seeded
    // sibling history; an empty init commit is dropped by the eventual
    // rebase's --empty=drop, so the vault heals into a clean join.
    const server = createServer((_request, response) => {
      response.writeHead(401, { "www-authenticate": 'Basic realm="test"' });
      response.end("auth required\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const { port } = boundAddressSchema.parse(server.address());

    const root = join(scratchDir("inteligir-git-clone-fail-"), "vault");
    let seeded = false;
    const { created, cloned } = await ensureVaultRepo({
      root,
      remote: { url: `http://127.0.0.1:${String(port)}/vault.git`, source: "paired" },
      seed: async () => {
        seeded = true;
      },
      env,
    });
    expect(created).toBe(true);
    expect(cloned).toBe(false);
    expect(seeded).toBe(false);
    // Born HEAD, nothing else: one empty commit for the rebase to stand on.
    const count = await runGit(root, ["rev-list", "--count", "HEAD"], { env });
    expect(count.stdout.trim()).toBe("1");
  });
});

describe("a live remote provider", () => {
  it("an armed tick with no remote invokes no network git — no origin is ever written", async () => {
    const root = scratchDir("inteligir-git-idle-");
    await ensureVaultRepo({ root, env });
    let reads = 0;
    const engine = createGitEngine({
      root,
      remote: () => {
        reads += 1;
        return null;
      },
      env,
    });
    cleanups.push(() => engine.dispose());
    engine.startAutoSync(50);
    await waitFor(async () => Promise.resolve(reads >= 2));
    // ensureOriginRemote is reachable only inside a pass; a pass that ran
    // would have persisted `origin` into .git/config.
    await expect(runGit(root, ["remote", "get-url", "origin"], { env })).rejects.toThrow();
  });

  it("turns sync on mid-life — the pairing flip needs no engine restart", async () => {
    const remote = await makeBareRemote();
    const root = scratchDir("inteligir-git-live-");
    await ensureVaultRepo({ root, env });
    let current: { url: string; source: "paired"; account: string } | null = null;
    const engine = createGitEngine({ root, remote: () => current, env });
    cleanups.push(() => engine.dispose());

    expect((await engine.status()).state).toBe("no-remote");

    current = { url: remote, source: "paired", account: "user-live" };
    await writeFile(join(root, "note.md"), "# paired\n");
    await engine.commitNow();
    expect((await engine.syncNow()).state).toBe("clean");

    current = null;
    expect((await engine.status()).state).toBe("no-remote");
  });
});
