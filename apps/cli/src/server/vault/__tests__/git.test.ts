import { existsSync, mkdirSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { ensureVaultRepo, type EnsureVaultRepoArgs } from "../git-bootstrap";
import { createGitEngine, type GitEngine, type GitEngineArgs } from "../git-engine";
import { GitError, runGit } from "../git-run";
import { boundAddressSchema } from "../../__tests__/bound-address";
import { hermeticGitEnv } from "./git-test-env";
import { makeTempDir } from "../../__tests__/temp-dir";

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

interface AutoCommitTiming {
  quietMs: number;
  maxWaitMs: number;
}

const FAST_COMMIT: AutoCommitTiming = { quietMs: 50, maxWaitMs: 500 };

async function makeEngine(args: {
  remoteUrl: string | null;
  timing?: AutoCommitTiming;
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
    ...args.timing,
  };
  const engine = createGitEngine(engineArgs);
  onTestFinished(() => engine.dispose());
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

async function awaitCommitCount(root: string, count: number): Promise<void> {
  await vi.waitFor(async () => expect(await commitCount(root)).toBe(count), { timeout: 5_000 });
}

// only a negative ("no commit follows") waits this out; a coming commit is awaited by count.
function debounceSettled(timing: AutoCommitTiming): Promise<void> {
  return delay(timing.maxWaitMs + timing.quietMs);
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

    const again = await ensureVaultRepo({ root, env });
    expect(again.created).toBe(false);
    expect(await commitCount(root)).toBe(1);
  });
});

describe("what a scheduled commit costs", () => {
  it("stages the union of the paths it was told about, and nothing else", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null, timing: FAST_COMMIT });
    const before = await commitCount(root);

    await writeFile(join(root, "told-a.md"), "a\n", "utf8");
    engine.scheduleCommit(["told-a.md"]);
    await writeFile(join(root, "told-b.md"), "b\n", "utf8");
    engine.scheduleCommit(["told-b.md"]);
    await writeFile(join(root, "untold.md"), "c\n", "utf8");

    await awaitCommitCount(root, before + 1);
    const { stdout } = await runGit(root, ["show", "--name-only", "--format=", "HEAD"], { env });
    expect(stdout.trim().split("\n").toSorted()).toEqual(["told-a.md", "told-b.md"]);
    expect(await engine.commitNow()).toEqual({ files: 1 });
  });

  it("stages `[a].md` alone — a note's name is a path, never a glob for `a.md`", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null, timing: FAST_COMMIT });
    await writeFile(join(root, "a.md"), "plain\n", "utf8");
    await writeFile(join(root, "[a].md"), "bracketed\n", "utf8");
    await engine.commitNow();
    const before = await commitCount(root);

    await writeFile(join(root, "[a].md"), "bracketed edit\n", "utf8");
    engine.scheduleCommit(["[a].md"]);
    await writeFile(join(root, "a.md"), "user edit\n", "utf8");

    await awaitCommitCount(root, before + 1);
    const { stdout } = await runGit(root, ["show", "--name-status", "--format=", "HEAD"], { env });
    expect(stdout.trim()).toBe("M\t[a].md");
    expect(await lastMessage(root)).toBe("vault: update [a].md");
    expect(await engine.commitNow()).toEqual({ files: 1 });
    expect(await lastMessage(root)).toBe("vault: update a.md");
  });

  it("falls back to the whole tree when one scheduler named no paths", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null, timing: FAST_COMMIT });
    const before = await commitCount(root);

    await writeFile(join(root, "told.md"), "a\n", "utf8");
    engine.scheduleCommit(["told.md"]);
    await writeFile(join(root, "untold.md"), "b\n", "utf8");
    engine.scheduleCommit();

    await awaitCommitCount(root, before + 1);
    expect(await engine.commitNow()).toBeNull();
    await expectCleanRepo(root);
  });

  it("announces no status change: a commit is not a transition", async () => {
    const { root, engine, statusChanges } = await makeEngine({
      remoteUrl: null,
      timing: FAST_COMMIT,
    });
    const before = await commitCount(root);
    await writeFile(join(root, "saved.md"), "a\n", "utf8");
    engine.scheduleCommit(["saved.md"]);
    await awaitCommitCount(root, before + 1);

    expect(statusChanges()).toBe(0);
    await engine.commitNow();
    expect(statusChanges()).toBe(0);
  });
});

describe("auto-commit", () => {
  it("lands a burst of writes as ONE commit with the file count", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null, timing: FAST_COMMIT });
    const before = await commitCount(root);

    for (const name of ["a.md", "b.md", "c.md"]) {
      await writeFile(join(root, name), `# ${name}\n`, "utf8");
      engine.scheduleCommit([name]);
    }

    await awaitCommitCount(root, before + 1);
    expect(await lastMessage(root)).toBe("vault: update 3 files");
    await debounceSettled(FAST_COMMIT);
    expect(await commitCount(root)).toBe(before + 1);
    await expectCleanRepo(root);
  });

  it("names the file when the commit is one file — the log has to be answerable", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null, timing: FAST_COMMIT });
    const before = await commitCount(root);

    await writeFile(join(root, "a note.md"), "# One\n", "utf8");
    engine.scheduleCommit(["a note.md"]);

    await awaitCommitCount(root, before + 1);
    expect(await lastMessage(root)).toBe("vault: update a note.md");
  });

  it("names the file on the unscoped sweep too, so the two paths agree", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null });
    await writeFile(join(root, "swept.md"), "# Swept\n", "utf8");
    expect(await engine.commitNow()).toEqual({ files: 1 });
    expect(await lastMessage(root)).toBe("vault: update swept.md");
  });

  it("commitNow is a no-op on a clean tree and commits as the engine", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null });
    expect(await engine.commitNow()).toBeNull();

    await writeFile(join(root, "note.md"), "a user edit\n", "utf8");
    expect(await engine.commitNow()).toEqual({ files: 1 });
    const { stdout } = await runGit(root, ["log", "-1", "--format=%an <%ae>|%cn"], { env });
    expect(stdout.trim()).toBe("inteligir <vault@inteligir.local>|inteligir");
  });

  it("interleaved turns attribute separately: each commits ITS write set only", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null, timing: FAST_COMMIT });
    const before = await commitCount(root);

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

    await awaitCommitCount(root, before + 3);
    files = (await runGit(root, ["show", "--name-only", "--format=%an", "HEAD"], { env })).stdout;
    expect(files).toContain("inteligir");
    expect(files).toContain("user.md");
    await expectCleanRepo(root);

    expect(
      await engine.commitPaths(["a.md"], { name: "agent-a", email: "a@inteligir" }, "noop"),
    ).toBeNull();
  });

  it("a commit hold defers the debounce flush; release re-arms it", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null, timing: FAST_COMMIT });
    const before = await commitCount(root);

    const release = engine.holdCommits();
    await writeFile(join(root, "mid-turn.md"), "agent writing\n", "utf8");
    engine.scheduleCommit();
    await debounceSettled(FAST_COMMIT);
    expect(await commitCount(root)).toBe(before);

    const committed = await engine.commitPaths(
      ["mid-turn.md"],
      { name: "inteligir-agent", email: "agent@inteligir.local" },
      "agent: vault update\n\nThread: thr_test",
    );
    expect(committed).toEqual({ files: 1 });
    release();

    await debounceSettled(FAST_COMMIT);
    expect(await commitCount(root)).toBe(before + 1);
    expect(await lastMessage(root)).toBe("agent: vault update");
    const identity = await runGit(root, ["log", "-1", "--format=%an <%ae>|%cn"], { env });
    expect(identity.stdout.trim()).toBe("inteligir-agent <agent@inteligir.local>|inteligir");
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

    // first contact: A creates the remote branch, B rebases onto it.
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

    await expectCleanRepo(b.root);
    expect(await readFile(join(b.root, "shared.md"), "utf8")).toBe("from B\n");

    expect((await b.engine.status()).state).toBe("conflict");
  });

  it("says a hold is holding it instead of answering as if a pass ran", async () => {
    const remote = await makeBareRemote();
    const { engine } = await makeEngine({ remoteUrl: remote });
    expect((await engine.syncNow()).state).toBe("clean");

    const release = engine.holdCommits();
    expect((await engine.syncNow()).state).toBe("held");
    expect((await engine.status()).state).toBe("held");

    release();
    expect((await engine.syncNow()).state).toBe("clean");
  });

  it("says offline rather than clean when the remote cannot be reached", async () => {
    // nothing local to push: unpushed is measured against the remote-tracking ref, so a stale one would answer clean.
    const { engine } = await makeEngine({ remoteUrl: join(await makeBareRemote(), "gone") });
    const status = await engine.syncNow();
    expect(status.state).toBe("offline");
    expect(status.lastError).not.toBeNull();
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
  async function gitEnvValue(root: string, name: string): Promise<string> {
    const { stdout } = await runGit(
      root,
      ["-c", `alias.dumpenv=!printenv ${name} || true`, "dumpenv"],
      { env },
    );
    return stdout.trim();
  }

  it("never lets git ask this process a question", async () => {
    // a git prompt blocks under the repo lock, stalling every vault write until the timeout.
    const root = scratchDir("inteligir-git-env-");
    await ensureVaultRepo({ root, env });
    expect(await gitEnvValue(root, "GIT_TERMINAL_PROMPT")).toBe("0");
    expect(await gitEnvValue(root, "GIT_SSH_COMMAND")).toBe("ssh -o BatchMode=yes");
  });

  it("passes every pathspec literally — the builder carries the flag, not each caller", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null });
    await writeFile(join(root, "a.md"), "plain\n", "utf8");
    await writeFile(join(root, "[a].md"), "bracketed\n", "utf8");
    await engine.commitNow();

    // tracked files: the glob reaches through the index, where an untracked walk only matches by name.
    await writeFile(join(root, "a.md"), "plain edit\n", "utf8");
    await writeFile(join(root, "[a].md"), "bracketed edit\n", "utf8");
    await runGit(root, ["add", "-A", "--", "[a].md"], { env });
    const { stdout } = await runGit(root, ["diff", "--cached", "--name-only"], { env });
    expect(stdout.trim()).toBe("[a].md");
  });

  it("leaves a caller's own GIT_SSH_COMMAND alone", async () => {
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
    // GitHub-style hosts answer 404 for a private repo the credential cannot see.
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

    const accountRoot = join(scratchDir("inteligir-git-clone-miss-account-"), "vault");
    let accountSeeded = false;
    const viaAccount = await ensureVaultRepo({
      root: accountRoot,
      remote: {
        url: join(scratchDir("inteligir-git-nowhere-2-"), "gone.git"),
        source: "account",
        account: "user-a",
      },
      seed: async () => {
        accountSeeded = true;
      },
      env,
    });
    expect(viaAccount.cloned).toBe(false);
    expect(accountSeeded).toBe(true);
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
      remote: () => ({ url: remote, source: "account", account }),
      env,
    });
    onTestFinished(() => engine.dispose());

    await writeFile(join(root, "note.md"), "# a\n");
    await engine.commitNow();
    expect((await engine.syncNow()).state).toBe("clean");
    const marker = await runGit(root, ["config", "--get", "inteligir.account"], { env });
    expect(marker.stdout.trim()).toBe("user-a");

    const pushedCount = Number(
      (await runGit(remote, ["rev-list", "--count", "main"], { env })).stdout.trim(),
    );
    account = "user-b";
    const status = await engine.syncNow();
    expect(status.state).toBe("account-mismatch");
    expect(
      Number((await runGit(remote, ["rev-list", "--count", "main"], { env })).stdout.trim()),
    ).toBe(pushedCount);

    account = "user-a";
    expect((await engine.syncNow()).state).toBe("clean");
  });

  it("drops the previous account's conflict, which outranks the mismatch", async () => {
    const remote = await makeBareRemote();
    const a = await makeEngine({ remoteUrl: remote });
    const root = scratchDir("inteligir-git-fence-conflict-");
    await ensureVaultRepo({ root, env });
    let account = "user-a";
    const engine = createGitEngine({
      root,
      remote: () => ({ url: remote, source: "account", account }),
      env,
    });
    onTestFinished(() => engine.dispose());

    await a.engine.syncNow();
    await engine.syncNow();
    await a.engine.syncNow();

    await writeFile(join(a.root, "shared.md"), "from A\n", "utf8");
    await a.engine.commitNow();
    await a.engine.syncNow();

    await writeFile(join(root, "shared.md"), "from B\n", "utf8");
    await engine.commitNow();
    expect((await engine.syncNow()).state).toBe("conflict");

    account = "user-b";
    expect((await engine.syncNow()).state).toBe("account-mismatch");
    expect((await engine.status()).state).toBe("account-mismatch");
  });
});

describe("a refused credential", () => {
  it("surfaces as `unauthorized`, not `offline`", async () => {
    // offline heals on its own; a revoked device fails every retry until the user signs in again.
    const server = createServer((_request, response) => {
      response.writeHead(401, { "www-authenticate": 'Basic realm="test"' });
      response.end("auth required\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())));
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
    // an empty init commit is dropped by the eventual rebase's --empty=drop, so the vault heals into a clean join.
    const server = createServer((_request, response) => {
      response.writeHead(401, { "www-authenticate": 'Basic realm="test"' });
      response.end("auth required\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const { port } = boundAddressSchema.parse(server.address());

    const root = join(scratchDir("inteligir-git-clone-fail-"), "vault");
    let seeded = false;
    const { created, cloned } = await ensureVaultRepo({
      root,
      remote: { url: `http://127.0.0.1:${String(port)}/vault.git`, source: "account" },
      seed: async () => {
        seeded = true;
      },
      env,
    });
    expect(created).toBe(true);
    expect(cloned).toBe(false);
    expect(seeded).toBe(false);
    const count = await runGit(root, ["rev-list", "--count", "HEAD"], { env });
    expect(count.stdout.trim()).toBe("1");
  });
});

describe("the bootstrap port", () => {
  interface Invocation {
    cwd: string;
    args: string[];
    timeoutMs: number | undefined;
    env: Record<string, string> | undefined;
  }

  // init creates .git/info because ensureLocalExclude appends there.
  function fakeGit(clone: "missing" | "failed") {
    const calls: Invocation[] = [];
    const run = (
      cwd: string,
      args: readonly string[],
      options: { timeoutMs?: number; env?: Record<string, string> } = {},
    ): Promise<{ stdout: string }> => {
      calls.push({ cwd, args: [...args], timeoutMs: options.timeoutMs, env: options.env });
      switch (args[0]) {
        case "clone":
          return Promise.reject(
            new GitError(
              "git clone failed",
              clone === "missing"
                ? "fatal: repository 'https://cloud.test/v1/git/me/' not found"
                : "fatal: unable to access 'https://cloud.test/v1/git/me/': could not resolve host",
            ),
          );
        case "init":
          mkdirSync(join(cwd, ".git", "info"), { recursive: true });
          return Promise.resolve({ stdout: "" });
        case "rev-parse":
          return Promise.reject(new GitError("git rev-parse failed", ""));
        default:
          return Promise.resolve({ stdout: "" });
      }
    };
    return { calls, run };
  }

  it("drives clone-miss → init → seed → born HEAD through the injected run", async () => {
    const root = join(scratchDir("inteligir-git-port-"), "vault");
    const fake = fakeGit("missing");
    let seeded = false;
    const args: EnsureVaultRepoArgs = {
      root,
      remote: { url: "https://cloud.test/v1/git/me/", source: "account", account: "user-x" },
      seed: async () => {
        seeded = true;
      },
      run: fake.run,
    };
    const { created, cloned } = await ensureVaultRepo(args);

    expect(created).toBe(true);
    expect(cloned).toBe(false);
    expect(seeded).toBe(true);
    expect(fake.calls.map((call) => call.args[0])).toEqual([
      "clone",
      "init",
      "rev-parse",
      "add",
      "-c",
    ]);
    const clone = fake.calls[0];
    expect(clone?.cwd).not.toBe(root);
    expect(clone?.timeoutMs).toBe(120_000);
    const commit = fake.calls.at(-1);
    expect(commit?.args).toContain("vault: initialize");
    expect(commit?.env?.GIT_AUTHOR_NAME).toBe("inteligir");
  });

  it("boots EMPTY on a clone failure that is not a missing repo", async () => {
    const root = join(scratchDir("inteligir-git-port-fail-"), "vault");
    const fake = fakeGit("failed");
    let seeded = false;
    await ensureVaultRepo({
      root,
      remote: { url: "https://cloud.test/v1/git/me/", source: "account", account: "user-x" },
      seed: async () => {
        seeded = true;
      },
      run: fake.run,
    });
    expect(seeded).toBe(false);
    expect(fake.calls.at(-1)?.args).toContain("vault: initialize");
  });
});

describe("dispose", () => {
  it("surfaces a failed shutdown flush instead of swallowing it", async () => {
    const root = scratchDir("inteligir-git-dispose-");
    await ensureVaultRepo({ root, env });
    const engine = createGitEngine({ root, remote: () => null, env });
    await writeFile(join(root, "pending.md"), "unflushed\n", "utf8");
    // break the repo so the flush's own git call fails.
    await rm(join(root, ".git"), { recursive: true, force: true });
    await expect(engine.dispose()).rejects.toThrow(/git/);
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
    onTestFinished(() => engine.dispose());
    engine.startAutoSync(50);
    await vi.waitFor(() => expect(reads).toBeGreaterThanOrEqual(2));
    // a pass that ran would have persisted origin into .git/config.
    await expect(runGit(root, ["remote", "get-url", "origin"], { env })).rejects.toThrow();
  });

  it("turns sync on mid-life — the sign-in flip needs no engine restart", async () => {
    const remote = await makeBareRemote();
    const root = scratchDir("inteligir-git-live-");
    await ensureVaultRepo({ root, env });
    let current: { url: string; source: "account"; account: string } | null = null;
    const engine = createGitEngine({ root, remote: () => current, env });
    onTestFinished(() => engine.dispose());

    expect((await engine.status()).state).toBe("no-remote");

    current = { url: remote, source: "account", account: "user-live" };
    await writeFile(join(root, "note.md"), "# signed in\n");
    await engine.commitNow();
    expect((await engine.syncNow()).state).toBe("clean");

    current = null;
    expect((await engine.status()).state).toBe("no-remote");
  });
});
