import { packExceeds, readGitBlob, runGit } from "../git-run";
import type { GitRunner, RunGitOptions } from "../git-run";

// the developer's global/system git config (signing, hooks, templates) must not leak into scratch repos.
// useConfigOnly stops git guessing a committer from the host name, which macOS answers and a Linux
// runner refuses, so a git call missing the engine's identity fails here as it would on Linux.
export const hermeticGitEnv = () => ({
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_KEY_0: "user.useConfigOnly",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_VALUE_0: "true",
});

// the runner a suite hands the server, over that config; `extra` is a case's own rows on top (a
// gated transport, a template dir), and a call's own env still wins.
export const hermeticGit = (extra: Record<string, string> = {}): GitRunner => {
  const base = { ...hermeticGitEnv(), ...extra };
  const over = (options: RunGitOptions = {}): RunGitOptions => ({
    ...options,
    env: { ...base, ...options.env },
  });
  return {
    packExceeds: async (cwd, revisions, capBytes, options) =>
      await packExceeds(cwd, revisions, capBytes, over(options)),
    readBlob: async (cwd, oid, options) => await readGitBlob(cwd, oid, over(options)),
    run: async (cwd, gitArgs, options) => await runGit(cwd, gitArgs, over(options)),
  };
};
