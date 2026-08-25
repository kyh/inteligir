/**
 * Hermetic git for tests: the developer's global/system config (signing,
 * hooks, templates) must not leak into scratch repos.
 */
export function hermeticGitEnv() {
  return {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
}
