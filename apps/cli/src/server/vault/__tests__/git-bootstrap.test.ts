import { once } from "node:events";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { VAULT_TMP_PREFIX } from "@repo/notes/knowledge/vault-path";
import { CAPTURE_INBOX_PATH } from "@repo/notes/sync/reconcile-file";
import { describe, expect, it, onTestFinished } from "vitest";
import { ensureVaultRepo, SEED_COMMIT_KEY } from "../git-bootstrap";
import type { EnsureVaultRepoArgs } from "../git-bootstrap";
import { createGitEngine } from "../git-engine";
import { GitError } from "../git-run";
import { boundAddressSchema } from "../../__tests__/bound-address";
import {
  commitCount,
  expectCleanRepo,
  git,
  gitDirPath,
  makeBareRemote,
  makeEngine,
  makeWorktreeVault,
  refusingHook,
  scratchDir,
  syncState,
  TEST_DEVICE,
  trackedFiles,
} from "./git-fixtures";
import { hermeticGit } from "./git-test-env";

describe("ensureVaultRepo", () => {
  it("creates, inits and seeds a missing vault, and leaves HEAD born", async () => {
    const parent = scratchDir("inteligir-git-boot-");
    const root = path.join(parent, "vault");
    const { created } = await ensureVaultRepo({
      git,
      root,
      seed: async (dir) => {
        await writeFile(path.join(dir, "Welcome.md"), "hello\n", "utf-8");
      },
    });
    expect(created).toBe(true);
    expect(await readFile(path.join(root, "Welcome.md"), "utf-8")).toBe("hello\n");
    expect(await commitCount(root)).toBe(1);

    const again = await ensureVaultRepo({ git, root });
    expect(again.created).toBe(false);
    expect(await commitCount(root)).toBe(1);
  });

  it("stages nothing before the listen: a folder of notes gets an empty HEAD, and the sweep commits them", async () => {
    const root = scratchDir("inteligir-git-folder-");
    await writeFile(path.join(root, "existing.md"), "already here\n", "utf-8");
    await ensureVaultRepo({ git, root });
    expect(await commitCount(root)).toBe(1);
    expect(await trackedFiles(root)).toEqual([]);

    const engine = createGitEngine({
      deviceName: () => TEST_DEVICE,
      git,
      remote: () => null,
      root,
    });
    onTestFinished(async () => {
      await engine.dispose();
    });
    expect(await engine.commitNow()).toEqual({ files: 1 });
    expect(await trackedFiles(root)).toEqual(["existing.md"]);
  });

  it("boots a repo a hooks-only template made, past a hook that refuses every commit", async () => {
    const template = scratchDir("inteligir-git-template-");
    await refusingHook(path.join(template, "hooks"), "commit-msg");
    const root = path.join(scratchDir("inteligir-git-templated-"), "vault");
    await ensureVaultRepo({ git: hermeticGit({ GIT_TEMPLATE_DIR: template }), root });

    expect(await commitCount(root)).toBe(1);
    const exclude = await readFile(await gitDirPath(root, "info/exclude"), "utf-8");
    expect(exclude.split("\n")).toContain(`${VAULT_TMP_PREFIX}*`);
  });

  it("boots a linked worktree, whose .git is a file, and excludes in the info/ it shares", async () => {
    const root = await makeWorktreeVault();
    await ensureVaultRepo({ git, root });
    await ensureVaultRepo({ git, root });

    const exclude = await readFile(await gitDirPath(root, "info/exclude"), "utf-8");
    expect(exclude.split("\n").filter((line) => line === `${VAULT_TMP_PREFIX}*`)).toHaveLength(1);
    await writeFile(path.join(root, `${VAULT_TMP_PREFIX}staged`), "mid-write\n", "utf-8");
    await expectCleanRepo(root);
  });

  it("marks the root capture inbox, and only it, merge=union, once however many boots", async () => {
    const root = scratchDir("inteligir-git-inbox-attr-");
    await ensureVaultRepo({ git, root });
    await ensureVaultRepo({ git, root });

    const line = `/${CAPTURE_INBOX_PATH} merge=union`;
    const attributes = await readFile(await gitDirPath(root, "info/attributes"), "utf-8");
    expect(attributes.split("\n").filter((entry) => entry === line)).toHaveLength(1);
    const nested = path.join("notes", CAPTURE_INBOX_PATH);
    const { stdout } = await git.run(root, [
      "check-attr",
      "merge",
      "--",
      CAPTURE_INBOX_PATH,
      nested,
    ]);
    expect(stdout).toBe(`${CAPTURE_INBOX_PATH}: merge: union\n${nested}: merge: unspecified\n`);
  });
});

describe("the clone path", () => {
  it("clones a populated remote instead of init+seed — a second device joins the vault", async () => {
    const remote = await makeBareRemote();
    const a = await makeEngine({ remoteUrl: remote });
    await writeFile(path.join(a.root, "note.md"), "# from A\n");
    await a.engine.commitNow();
    expect(await syncState(a.engine)).toBe("clean");

    const bRoot = path.join(scratchDir("inteligir-git-clone-"), "vault");
    let seeded = false;
    const { created, cloned } = await ensureVaultRepo({
      git,
      remote: { source: "explicit", url: remote },
      root: bRoot,
      seed: () => {
        seeded = true;
      },
    });
    expect(created).toBe(true);
    expect(cloned).toBe(true);
    expect(seeded).toBe(false);
    expect(await readFile(path.join(bRoot, "note.md"), "utf-8")).toBe("# from A\n");
  });

  it("seeds only the HOSTED missing-repo miss; an explicit remote's miss boots empty", async () => {
    // GitHub-style hosts answer 404 for a private repo the credential cannot see.
    const bRoot = path.join(scratchDir("inteligir-git-clone-miss-"), "vault");
    let seeded = false;
    const { created, cloned } = await ensureVaultRepo({
      git,
      remote: {
        source: "explicit",
        url: path.join(scratchDir("inteligir-git-nowhere-"), "gone.git"),
      },
      root: bRoot,
      seed: () => {
        seeded = true;
      },
    });
    expect(created).toBe(true);
    expect(cloned).toBe(false);
    expect(seeded).toBe(false);
    expect(existsSync(path.join(bRoot, ".git"))).toBe(true);

    const accountRoot = path.join(scratchDir("inteligir-git-clone-miss-account-"), "vault");
    let accountSeeded = false;
    const viaAccount = await ensureVaultRepo({
      git,
      remote: {
        accountId: "user-a",
        source: "account",
        url: path.join(scratchDir("inteligir-git-nowhere-2-"), "gone.git"),
      },
      root: accountRoot,
      seed: () => {
        accountSeeded = true;
      },
    });
    expect(viaAccount.cloned).toBe(false);
    expect(accountSeeded).toBe(true);
  });
});

describe("clone failure classes", () => {
  it("an unreachable remote boots EMPTY — the seed waits for a remote that answered", async () => {
    // an empty init commit is dropped by the eventual rebase's --empty=drop, so the vault heals into a clean join.
    const server = createServer((_request, response) => {
      response.writeHead(401, { "www-authenticate": 'Basic realm="test"' });
      response.end("auth required\n");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    onTestFinished(async () => {
      server.close();
      await once(server, "close");
    });
    const { port } = boundAddressSchema.parse(server.address());

    const root = path.join(scratchDir("inteligir-git-clone-fail-"), "vault");
    let seeded = false;
    const { created, cloned } = await ensureVaultRepo({
      git,
      remote: {
        accountId: "user-a",
        source: "account",
        url: `http://127.0.0.1:${String(port)}/vault.git`,
      },
      root,
      seed: () => {
        seeded = true;
      },
    });
    expect(created).toBe(true);
    expect(cloned).toBe(false);
    expect(seeded).toBe(false);
    const count = await git.run(root, ["rev-list", "--count", "HEAD"]);
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

  const FAKE_HEAD = "f".repeat(40);

  // answers --git-path as a plain repo would, and HEAD once a commit ran; the bootstrap makes the
  // dir it appends in.
  const fakeGit = (clone: "missing" | "failed") => {
    const calls: Invocation[] = [];
    let born = false;
    const run = async (
      cwd: string,
      args: readonly string[],
      options: { timeoutMs?: number; env?: Record<string, string> } = {},
    ): Promise<{ stdout: string }> => {
      calls.push({ args: [...args], cwd, env: options.env, timeoutMs: options.timeoutMs });
      born ||= args.includes("commit");
      switch (args[0]) {
        case "clone": {
          throw new GitError(
            "git clone failed",
            clone === "missing"
              ? "fatal: repository 'https://cloud.test/v1/git/me/' not found"
              : "fatal: unable to access 'https://cloud.test/v1/git/me/': could not resolve host",
          );
        }
        case "rev-parse": {
          if (args[1] === "--git-path") {
            return { stdout: `.git/${args[2] ?? ""}\n` };
          }
          if (born) {
            return { stdout: `${FAKE_HEAD}\n` };
          }
          throw new GitError("git rev-parse failed", "");
        }
        case undefined: {
          throw new Error("Not implemented yet: undefined case");
        }
        default: {
          return { stdout: "" };
        }
      }
    };
    return { calls, run };
  };

  it("drives clone-miss → init → seed → the seed's own first commit through the injected run, and records it", async () => {
    const root = path.join(scratchDir("inteligir-git-port-"), "vault");
    const fake = fakeGit("missing");
    let seeded = false;
    const args: EnsureVaultRepoArgs = {
      remote: {
        accountId: "user-x",
        source: "account",
        url: "https://cloud.test/v1/git/me/",
      },
      git: fake,
      root,
      seed: () => {
        seeded = true;
      },
    };
    const { created, cloned } = await ensureVaultRepo(args);

    expect(created).toBe(true);
    expect(cloned).toBe(false);
    expect(seeded).toBe(true);
    expect(fake.calls.map((call) => call.args.slice(0, 2).join(" "))).toEqual([
      "clone --",
      "init -b",
      "rev-parse --git-path",
      "rev-parse --git-path",
      "rev-parse --verify",
      "add -A",
      "commit --allow-empty",
      "rev-parse --verify",
      `config ${SEED_COMMIT_KEY}`,
    ]);
    const [clone] = fake.calls;
    expect(clone?.cwd).not.toBe(root);
    expect(clone?.timeoutMs).toBe(120_000);
    const commit = fake.calls.find((call) => call.args.includes("commit"));
    expect(commit?.args).toContain("vault: initialize");
    expect(commit?.env?.GIT_AUTHOR_NAME).toBe("inteligir");
    expect(fake.calls.at(-1)?.args).toEqual(["config", SEED_COMMIT_KEY, FAKE_HEAD]);
  });

  it("boots EMPTY on a clone failure that is not a missing repo", async () => {
    const root = path.join(scratchDir("inteligir-git-port-fail-"), "vault");
    const fake = fakeGit("failed");
    let seeded = false;
    await ensureVaultRepo({
      remote: {
        accountId: "user-x",
        source: "account",
        url: "https://cloud.test/v1/git/me/",
      },
      git: fake,
      root,
      seed: () => {
        seeded = true;
      },
    });
    expect(seeded).toBe(false);
    expect(fake.calls.at(-1)?.args).toContain("vault: initialize");
    expect(fake.calls.some((call) => call.args.includes("add"))).toBe(false);
  });
});
