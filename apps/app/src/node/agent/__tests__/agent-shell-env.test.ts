// The agent's shell must be able to RUN what the instructions tell it to run.
// A pointer at `inteligir` with no `inteligir` on PATH is the headline
// feature failing silently, so both halves are pinned here: the bin really
// resolves from this checkout's layout, and the composed env puts that
// directory on PATH without dropping what the shell already had.

import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAgentShellEnv, resolveCliBinDir } from "../agent-shell-env";

describe("resolveCliBinDir", () => {
  it("finds a directory holding an EXECUTABLE inteligir", () => {
    const binDir = resolveCliBinDir();
    expect(binDir).not.toBeNull();
    if (binDir === null) {
      return;
    }
    const binPath = join(binDir, "inteligir");
    expect(statSync(binPath).isFile()).toBe(true);
    // Throws unless the execute bit is set — a PATH entry pointing at a
    // non-executable file is the same failure as no entry at all.
    expect(() => accessSync(binPath, constants.X_OK)).not.toThrow();
  });

  it("answers null when no CLI ships beside the entry", () => {
    expect(resolveCliBinDir("file:///nowhere/at/all/module.ts")).toBeNull();
  });
});

describe("buildAgentShellEnv", () => {
  it("prepends the bin dir to the inherited PATH and carries the server URL", () => {
    const env = buildAgentShellEnv({
      serverUrl: "http://127.0.0.1:21999",
      env: { PATH: `/usr/bin${delimiter}/bin` },
      cliBinDir: "/repo/apps/cli/bin",
    });
    expect(env.INTELIGIR_SERVER_URL).toBe("http://127.0.0.1:21999");
    expect(env.PATH).toBe(`/repo/apps/cli/bin${delimiter}/usr/bin${delimiter}/bin`);
  });

  it("is the bin dir alone when the host process has no PATH", () => {
    const env = buildAgentShellEnv({
      serverUrl: "http://127.0.0.1:1",
      env: {},
      cliBinDir: "/repo/apps/cli/bin",
    });
    expect(env.PATH).toBe("/repo/apps/cli/bin");
  });

  it("leaves PATH untouched when no CLI resolved — never a dangling entry", () => {
    const env = buildAgentShellEnv({
      serverUrl: "http://127.0.0.1:1",
      env: { PATH: "/usr/bin" },
      cliBinDir: null,
    });
    expect(env).toEqual({ INTELIGIR_SERVER_URL: "http://127.0.0.1:1" });
  });
});
