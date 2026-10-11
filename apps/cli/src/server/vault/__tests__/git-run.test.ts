import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyNetworkFailure, GitError, identityEnv, runGit } from "../git-run";
import { initVault, lastMessage, makeEngine, scratchDir, TEST_DEVICE } from "./git-fixtures";
import { hermeticGitEnv } from "./git-test-env";

const env = hermeticGitEnv();

const gitEnvValue = async (root: string, name: string): Promise<string> => {
  const { stdout } = await runGit(
    root,
    ["-c", `alias.dumpenv=!printenv ${name} || true`, "dumpenv"],
    { env },
  );
  return stdout.trim();
};

describe("runGit", () => {
  it("never lets git ask this process a question", async () => {
    // nobody can answer a git prompt, so it only holds the invocation until the timeout.
    const root = scratchDir("inteligir-git-env-");
    await initVault(root);
    expect(await gitEnvValue(root, "GIT_TERMINAL_PROMPT")).toBe("0");
    expect(await gitEnvValue(root, "GIT_SSH_COMMAND")).toBe(
      "ssh -o BatchMode=yes -o ConnectTimeout=20",
    );
  });

  it("gives up on a stalled transfer long before the network timeout", async () => {
    const root = scratchDir("inteligir-git-stall-");
    await initVault(root);
    expect(await gitEnvValue(root, "GIT_HTTP_LOW_SPEED_LIMIT")).toBe("1000");
    expect(await gitEnvValue(root, "GIT_HTTP_LOW_SPEED_TIME")).toBe("30");
  });

  it("passes every pathspec literally — the builder carries the flag, not each caller", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null });
    await writeFile(path.join(root, "a.md"), "plain\n", "utf-8");
    await writeFile(path.join(root, "[a].md"), "bracketed\n", "utf-8");
    await engine.commitNow();

    // tracked files: the glob reaches through the index, where an untracked walk only matches by name.
    await writeFile(path.join(root, "a.md"), "plain edit\n", "utf-8");
    await writeFile(path.join(root, "[a].md"), "bracketed edit\n", "utf-8");
    await runGit(root, ["add", "-A", "--", "[a].md"], { env });
    const { stdout } = await runGit(root, ["diff", "--cached", "--name-only"], { env });
    expect(stdout.trim()).toBe("[a].md");
  });

  it("signs nothing whatever the vault's own policy — the builder carries it, not each caller", async () => {
    const root = scratchDir("inteligir-git-signing-");
    await initVault(root);
    await runGit(root, ["config", "commit.gpgsign", "true"], { env });
    await runGit(root, ["config", "gpg.program", "false"], { env });
    await runGit(root, ["commit", "--allow-empty", "-q", "-m", "unsigned"], {
      env: { ...env, ...identityEnv(TEST_DEVICE) },
    });
    expect(await lastMessage(root)).toBe("unsigned");
  });

  it("leaves a caller's own GIT_SSH_COMMAND alone", async () => {
    const root = scratchDir("inteligir-git-ssh-");
    await initVault(root);
    const { stdout } = await runGit(
      root,
      ["-c", "alias.dumpenv=!printenv GIT_SSH_COMMAND || true", "dumpenv"],
      { env: { ...env, GIT_SSH_COMMAND: "ssh -F /custom/config" } },
    );
    expect(stdout.trim()).toBe("ssh -F /custom/config");
  });
});

const failedPush = (stderr: string, signal: string | null = null) =>
  new GitError("git push failed", stderr, signal);

describe("classifyNetworkFailure", () => {
  it.each([
    ["fatal: Authentication failed for 'https://cloud.test/v1/git/me/'", "unauthorized"],
    [
      "fatal: unable to access 'https://cloud.test/': Could not resolve host: cloud.test",
      "offline",
    ],
    [
      "ssh: connect to host h port 22: Connection refused\nfatal: Could not read from remote repository.",
      "offline",
    ],
    ["error: RPC failed; curl 28 Operation too slow\nfatal: early EOF", "offline"],
    [
      "fatal: unable to access 'https://cloud.test/': The requested URL returned error: 503",
      "offline",
    ],
    [
      "fatal: unable to access 'https://cloud.test/': The requested URL returned error: 429",
      "offline",
    ],
    [
      "error: RPC failed; HTTP 413 curl 22 The requested URL returned error: 413\nfatal: the remote end hung up unexpectedly",
      "too-large",
    ],
    [
      "error: RPC failed; HTTP 413 curl 22 The requested URL returned error: 413 Request Entity Too Large",
      "too-large",
    ],
    [
      "error: RPC failed; HTTP 507 curl 22 The requested URL returned error: 507\nsend-pack: unexpected disconnect while reading sideband packet\nfatal: the remote end hung up unexpectedly",
      "full",
    ],
    [
      " ! [remote rejected] main -> main (pre-receive hook declined)\nerror: failed to push some refs",
      "rejected",
    ],
    [
      " ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs",
      "lost-race",
    ],
    [" ! [rejected]        main -> main (non-fast-forward)", "lost-race"],
  ])("%s → %s", (stderr, expected) => {
    expect(classifyNetworkFailure(failedPush(stderr))).toBe(expected);
  });

  it("calls a git the timeout killed offline, whatever it had printed", () => {
    expect(classifyNetworkFailure(failedPush("", "SIGTERM"))).toBe("offline");
  });
});
