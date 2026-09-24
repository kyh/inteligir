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
