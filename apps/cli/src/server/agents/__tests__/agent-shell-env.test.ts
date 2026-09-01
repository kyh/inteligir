// The agent's shell must be able to RUN what the instructions tell it to run.
// A pointer at `inteligir` with no `inteligir` on PATH is the headline
// feature failing silently, so both halves are pinned here: the bin really
// resolves from this checkout's layout, and the composed env puts that
// directory on PATH without dropping what the shell already had.

import { accessSync, constants, mkdirSync, statSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { resolveCliBinDir, toShellEnv } from "../agent-shell-env";
import { fakeSessionFacts } from "./agent-test-harness";

const CLI_BIN_DIR = "/repo/apps/cli/bin";

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

describe("toShellEnv", () => {
  it("prepends the bin dir to the inherited PATH and names the instance", () => {
    const env = toShellEnv(
      fakeSessionFacts({ dataDir: "/instances/one/data", cliBinDir: CLI_BIN_DIR }),
      {
        PATH: `/usr/bin${delimiter}/bin`,
      },
    );
    expect(env).toEqual({
      INTELIGIR_DATA_DIR: "/instances/one/data",
      PATH: `${CLI_BIN_DIR}${delimiter}/usr/bin${delimiter}/bin`,
    });
  });

  it("is the bin dir alone when the host process has no PATH", () => {
    const env = toShellEnv(fakeSessionFacts({ cliBinDir: CLI_BIN_DIR }), {});
    expect(env.PATH).toBe(CLI_BIN_DIR);
  });

  it("leaves PATH untouched when no CLI resolved — never a dangling entry", () => {
    const env = toShellEnv(fakeSessionFacts(), { PATH: "/usr/bin" });
    expect(env).toEqual({ INTELIGIR_DATA_DIR: "/instances/test/data" });
  });

  it("names the skills dir and the connected folders only when there are some", () => {
    expect(toShellEnv(fakeSessionFacts(), {})).not.toHaveProperty("INTELIGIR_SKILLS_DIR");
    expect(toShellEnv(fakeSessionFacts(), {})).not.toHaveProperty("INTELIGIR_CONNECTED_DIRS");
    const env = toShellEnv(
      fakeSessionFacts({ skillsDir: "/repo/skills", connectedDirs: ["/a", "/b"] }),
      {},
    );
    expect(env.INTELIGIR_SKILLS_DIR).toBe("/repo/skills");
    expect(env.INTELIGIR_CONNECTED_DIRS).toBe(`/a${delimiter}/b`);
  });
});
