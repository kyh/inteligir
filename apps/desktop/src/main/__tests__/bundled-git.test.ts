import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "inteligir/server/testing";
import { describe, expect, it, vi } from "vitest";
import { bundledGitEnv, isExecutableFile, resolveGit } from "../bundled-git";
import type { ResolveGitArgs } from "../bundled-git";
import { serverProcessEnv } from "../server-instance";
import type { ServerTarget } from "../server-instance";

const RESOURCES = "/Applications/Inteligir.app/Contents/Resources";
const BUNDLED_ROOT = path.join(RESOURCES, "git");
const SHELL_PATH = "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const COMMAND_LINE_TOOLS = "/Library/Developer/CommandLineTools";

const TARGET: ServerTarget = {
  dataDir: "/Users/someone/.inteligir",
  dataDirSource: "default",
  rootDataDir: "/Users/someone/.inteligir",
  vaultDir: "/Users/someone/Inteligir",
  vaultDirSource: "default",
};

const gitArgs = (overrides: Partial<ResolveGitArgs> = {}): ResolveGitArgs => ({
  isExecutableFile: () => false,
  isPackaged: true,
  printDeveloperDir: async () => await Promise.resolve(`${COMMAND_LINE_TOOLS}\n`),
  resourcesPath: RESOURCES,
  ...overrides,
});

const withToolsInstalled = (file: string): boolean =>
  file === path.join(COMMAND_LINE_TOOLS, "usr", "bin", "git");

const noDeveloperDirSelected = async (): Promise<string> =>
  await Promise.reject(new Error("xcode-select: error: unable to get active developer directory"));

describe("resolveGit", () => {
  it("runs the Mac's own git once the developer tools are installed", async () => {
    await expect(resolveGit(gitArgs({ isExecutableFile: withToolsInstalled }))).resolves.toEqual({
      source: "host",
    });
  });

  it("runs the bundled git when the developer dir holds no git, as on a Mac that never installed the tools", async () => {
    await expect(resolveGit(gitArgs())).resolves.toEqual({
      root: BUNDLED_ROOT,
      source: "bundled",
    });
  });

  it("runs the bundled git when no developer dir is selected at all", async () => {
    await expect(
      resolveGit(
        gitArgs({
          isExecutableFile: withToolsInstalled,
          printDeveloperDir: noDeveloperDirSelected,
        }),
      ),
    ).resolves.toEqual({ root: BUNDLED_ROOT, source: "bundled" });
  });

  it("leaves a dev launch on the developer's own git without asking", async () => {
    const printDeveloperDir = vi.fn<() => Promise<string>>();
    await expect(resolveGit(gitArgs({ isPackaged: false, printDeveloperDir }))).resolves.toEqual({
      source: "host",
    });
    expect(printDeveloperDir).not.toHaveBeenCalled();
  });
});

describe("bundledGitEnv", () => {
  it("names the bundled bin, exec path, templates and system config under the app's resources", () => {
    const env = bundledGitEnv({ root: BUNDLED_ROOT, source: "bundled" }, SHELL_PATH);
    expect(env).toEqual({
      GIT_CONFIG_SYSTEM: path.join(BUNDLED_ROOT, "etc", "gitconfig"),
      GIT_EXEC_PATH: path.join(BUNDLED_ROOT, "libexec", "git-core"),
      GIT_TEMPLATE_DIR: path.join(BUNDLED_ROOT, "share", "git-core", "templates"),
      PATH: `${path.join(BUNDLED_ROOT, "bin")}:${SHELL_PATH}`,
    });
  });

  it("sets nothing for the host's git, dev or packaged", () => {
    expect(bundledGitEnv({ source: "host" }, SHELL_PATH)).toBeNull();
  });

  it("never sets a GIT_CONFIG_COUNT row the hosted remote's bearer would collide with", () => {
    const env = bundledGitEnv({ root: BUNDLED_ROOT, source: "bundled" }, SHELL_PATH);
    expect(Object.keys(env ?? {}).filter((name) => name.startsWith("GIT_CONFIG_"))).toEqual([
      "GIT_CONFIG_SYSTEM",
    ]);
  });
});

describe("the server child's git", () => {
  it("puts the bundled bin ahead of every login-shell entry, so a PATH lookup of git finds it first", () => {
    const git = bundledGitEnv({ root: BUNDLED_ROOT, source: "bundled" }, SHELL_PATH);
    const env = serverProcessEnv(TARGET, { debug: false, git, isPackaged: true });
    const entries = (env.PATH ?? "").split(path.delimiter);
    expect(entries[0]).toBe(path.join(BUNDLED_ROOT, "bin"));
    expect(entries.slice(1)).toEqual(SHELL_PATH.split(path.delimiter));
    expect(env).toMatchObject({ GIT_EXEC_PATH: path.join(BUNDLED_ROOT, "libexec", "git-core") });
  });

  it("leaves PATH and git's variables to main's own env when the host's git runs", () => {
    const env: Readonly<Record<string, string>> = serverProcessEnv(TARGET, {
      debug: false,
      git: null,
      isPackaged: true,
    });
    expect(Object.keys(env).filter((name) => name === "PATH" || name.startsWith("GIT_"))).toEqual(
      [],
    );
  });
});

describe("isExecutableFile", () => {
  it("answers a file with the execute bit, and neither a plain file nor a directory", () => {
    const dir = makeTempDir("inteligir-bundled-git-");
    const tool = path.join(dir, "tool");
    const plain = path.join(dir, "plain");
    writeFileSync(tool, "#!/bin/sh\n");
    chmodSync(tool, 0o755);
    writeFileSync(plain, "");
    mkdirSync(path.join(dir, "folder"));
    expect(isExecutableFile(tool)).toBe(true);
    expect(isExecutableFile(plain)).toBe(false);
    expect(isExecutableFile(path.join(dir, "folder"))).toBe(false);
    expect(isExecutableFile(path.join(dir, "missing"))).toBe(false);
  });
});
