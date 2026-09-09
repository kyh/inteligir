// the developer's global/system git config (signing, hooks, templates) must not leak into scratch repos.
export const hermeticGitEnv = () => ({
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_SYSTEM: "/dev/null",
});
