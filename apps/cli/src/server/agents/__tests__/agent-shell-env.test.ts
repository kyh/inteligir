// The agent's shell must be able to RUN what the instructions tell it to run.
// A pointer at `inteligir` with no `inteligir` on PATH is the headline
// feature failing silently, so both halves are pinned here: the bin really
// resolves from this checkout's layout, and the composed env puts that
// directory on PATH without dropping what the shell already had.

import { accessSync, constants, mkdirSync, statSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
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

  it("answers null when the shipped CLI is not executable", () => {
    // npm strips the execute bit from every packed file that is not named in
    // `bin`, so a CLI shipped without a bin entry resolves to nothing — and a
    // PATH entry pointing at a non-executable file is the same failure as no
    // entry at all.
    const binDir = join(makeTempDir("unexecutable-cli-"), "bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, "inteligir"), "#!/bin/sh\n", { mode: 0o644 });

    expect(resolveCliBinDir(binDir)).toBeNull();
  });

  it("answers null when no CLI ships beside this program", () => {
    expect(resolveCliBinDir("/nowhere/at/all/bin")).toBeNull();
  });
});

describe("buildAgentShellEnv", () => {
  it("prepends the bin dir to the inherited PATH and names the instance", () => {
    const env = buildAgentShellEnv({
      dataDir: "/instances/one/data",
      env: { PATH: `/usr/bin${delimiter}/bin` },
      cliBinDir: "/repo/apps/cli/bin",
    });
    expect(env.INTELIGIR_DATA_DIR).toBe("/instances/one/data");
    expect(env.PATH).toBe(`/repo/apps/cli/bin${delimiter}/usr/bin${delimiter}/bin`);
  });

  it("is the bin dir alone when the host process has no PATH", () => {
    const env = buildAgentShellEnv({
      dataDir: "/instances/one/data",
      env: {},
      cliBinDir: "/repo/apps/cli/bin",
    });
    expect(env.PATH).toBe("/repo/apps/cli/bin");
  });

  it("leaves PATH untouched when no CLI resolved — never a dangling entry", () => {
    const env = buildAgentShellEnv({
      dataDir: "/instances/one/data",
      env: { PATH: "/usr/bin" },
      cliBinDir: null,
    });
    // The claim is about PATH, not the whole env: whether the vendored skills
    // resolve is a property of the layout the test runs in, and asserting the
    // object whole made this fail the day they started resolving.
    expect(env.PATH).toBeUndefined();
    expect(env.INTELIGIR_DATA_DIR).toBe("/instances/one/data");
  });
});
