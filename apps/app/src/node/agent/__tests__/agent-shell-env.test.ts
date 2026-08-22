// The agent's shell must be able to RUN what the instructions tell it to run.
// A pointer at `inteligir` with no `inteligir` on PATH is the headline
// feature failing silently, so both halves are pinned here: the bin really
// resolves from this checkout's layout, and the composed env puts that
// directory on PATH without dropping what the shell already had.

import { accessSync, constants, mkdirSync, statSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
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

  it("finds the CLI in the PACKAGED layout the launcher stages", () => {
    // apps/launcher/scripts/build.mjs copies the app and CLI into
    // `dist/apps/{app,cli}` precisely so this resolution keeps working from a
    // published install. Flattening that tree is invisible in every other
    // test — the capability just disappears — so the shape is pinned here.
    const root = makeTempDir("packaged-layout-");
    const bundleDir = join(root, "dist", "apps", "app", "dist-node");
    const cliBinDir = join(root, "dist", "apps", "cli", "bin");
    mkdirSync(bundleDir, { recursive: true });
    mkdirSync(cliBinDir, { recursive: true });
    writeFileSync(join(cliBinDir, "inteligir"), "#!/bin/sh\n", { mode: 0o755 });

    const entryUrl = pathToFileURL(join(bundleDir, "main.js")).href;
    expect(resolveCliBinDir(entryUrl)).toBe(cliBinDir);
  });

  it("answers null when the shipped CLI is not executable", () => {
    // npm strips the execute bit from every packed file that is not named in
    // `bin`, so a CLI shipped without a bin entry resolves to nothing.
    const root = makeTempDir("unexecutable-cli-");
    const bundleDir = join(root, "app", "dist-node");
    const cliBinDir = join(root, "cli", "bin");
    mkdirSync(bundleDir, { recursive: true });
    mkdirSync(cliBinDir, { recursive: true });
    writeFileSync(join(cliBinDir, "inteligir"), "#!/bin/sh\n", { mode: 0o644 });

    expect(resolveCliBinDir(pathToFileURL(join(bundleDir, "main.js")).href)).toBeNull();
  });

  it("answers null when no CLI ships beside the entry", () => {
    expect(resolveCliBinDir("file:///nowhere/at/all/module.ts")).toBeNull();
  });
});

describe("buildAgentShellEnv", () => {
  it("prepends the bin dir to the inherited PATH and carries the server URL and memory dir", () => {
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
    expect(env).toEqual({
      INTELIGIR_SERVER_URL: "http://127.0.0.1:1",
    });
  });
});
