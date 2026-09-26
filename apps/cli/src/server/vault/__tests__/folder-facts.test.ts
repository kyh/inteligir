import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { hostedVaultRemoteUrl, NO_ORIGIN } from "../../cloud/vault-remote";
import {
  folderExternalSync,
  inspectVaultFolder,
  readOriginConfig,
  REMOTE_MARKER_KEY,
} from "../folder-facts";
import { runGit } from "../git-run";
import type { RunGitCommand } from "../git-run";
import { hermeticGitEnv } from "./git-test-env";

const CLOUD_URL = "https://cloud.test";
const env = hermeticGitEnv();

const scratchHome = (): string => makeTempDir("inteligir-folder-facts-");

const gitIn =
  (root: string): RunGitCommand =>
  async (gitArgs) =>
    await runGit(root, gitArgs, { env });

const repoIn = async (home: string, name: string): Promise<string> => {
  const dir = path.join(home, name);
  mkdirSync(dir, { recursive: true });
  await gitIn(dir)(["init", "-b", "main"]);
  return dir;
};

const inspect = async (home: string, dir: string) =>
  await inspectVaultFolder(dir, { cloudUrl: CLOUD_URL, homeDir: home });

describe("readOriginConfig", () => {
  it("reads the origin and the app's mark in one pass", async () => {
    const repo = await repoIn(scratchHome(), "Vault");
    const git = gitIn(repo);
    expect(await readOriginConfig(git)).toEqual(NO_ORIGIN);
    await git(["remote", "add", "origin", "file:///srv/vault.git"]);
    expect(await readOriginConfig(git)).toEqual({
      markedAccount: false,
      url: "file:///srv/vault.git",
    });
    await git(["config", REMOTE_MARKER_KEY, "account"]);
    expect(await readOriginConfig(git)).toEqual({
      markedAccount: true,
      url: "file:///srv/vault.git",
    });
    await git(["remote", "remove", "origin"]);
    expect(await readOriginConfig(git)).toEqual({ markedAccount: true, url: null });
  });

  it("reads another remote's url as no origin", async () => {
    const repo = await repoIn(scratchHome(), "Vault");
    await gitIn(repo)(["remote", "add", "upstream", "file:///srv/other.git"]);
    expect(await readOriginConfig(gitIn(repo))).toEqual(NO_ORIGIN);
  });
});

describe("inspectVaultFolder", () => {
  it("reads the origin with the git the caller names", async () => {
    const home = scratchHome();
    const repo = await repoIn(home, "Vault");
    await gitIn(repo)(["remote", "add", "origin", "https://example.test/vault.git"]);
    expect(await inspect(home, repo)).toMatchObject({ remote: "https://example.test/vault.git" });
    const noGit = { PATH: path.join(home, "no-git-here") };
    expect(
      await inspectVaultFolder(repo, { cloudUrl: CLOUD_URL, gitEnv: noGit, homeDir: home }),
    ).toMatchObject({ exists: true, remote: null });
  });

  it("a folder not there yet is judged where it would land", async () => {
    const home = scratchHome();
    expect(await inspect(home, path.join(home, "Nowhere"))).toEqual({
      exists: false,
      externalSync: null,
    });
    expect(await inspect(home, path.join(home, "Library", "Mobile Documents", "Notes"))).toEqual({
      exists: false,
      externalSync: { kind: "icloud-drive" },
    });
  });

  it("an empty folder", async () => {
    const home = scratchHome();
    const dir = path.join(home, "Empty");
    mkdirSync(dir);
    expect(await inspect(home, dir)).toEqual({
      exists: true,
      externalSync: null,
      isRepo: false,
      noteCount: { capped: false, count: 0 },
      remote: null,
    });
  });

  it("a plain notes folder counts the notes, never what a dot-folder holds", async () => {
    const home = scratchHome();
    const dir = path.join(home, "Notes");
    mkdirSync(path.join(dir, "projects"), { recursive: true });
    mkdirSync(path.join(dir, ".obsidian"));
    writeFileSync(path.join(dir, "Welcome.md"), "# Welcome\n");
    writeFileSync(path.join(dir, "todo.txt"), "milk\n");
    writeFileSync(path.join(dir, "projects", "Plan.md"), "# Plan\n");
    writeFileSync(path.join(dir, "projects", "photo.png"), "");
    writeFileSync(path.join(dir, ".obsidian", "Hidden.md"), "# Hidden\n");
    expect(await inspect(home, dir)).toEqual({
      exists: true,
      externalSync: null,
      isRepo: false,
      noteCount: { capped: false, count: 3 },
      remote: null,
    });
  });

  it("a repo with an origin of its own names it, redacted", async () => {
    const home = scratchHome();
    const repo = await repoIn(home, "Vault");
    await gitIn(repo)(["remote", "add", "origin", "https://me:secret@git.example.com/vault.git"]);
    const facts = await inspect(home, repo);
    expect(facts).toMatchObject({
      exists: true,
      isRepo: true,
      remote: "https://git.example.com/vault.git",
    });
    expect(JSON.stringify(facts)).not.toContain("secret");
  });

  it("a repo whose origin is the hosted vault's names no remote of its own", async () => {
    const home = scratchHome();
    const hosted = await repoIn(home, "Hosted");
    await gitIn(hosted)(["remote", "add", "origin", hostedVaultRemoteUrl(CLOUD_URL)]);
    expect(await inspect(home, hosted)).toMatchObject({ isRepo: true, remote: null });
    const marked = await repoIn(home, "Marked");
    await gitIn(marked)(["remote", "add", "origin", "https://old.test/v1/git"]);
    await gitIn(marked)(["config", REMOTE_MARKER_KEY, "account"]);
    expect(await inspect(home, marked)).toMatchObject({ isRepo: true, remote: null });
  });

  it("a folder inside another repo is no repo, and never reads that repo's origin", async () => {
    const home = scratchHome();
    const outer = await repoIn(home, "Code");
    await gitIn(outer)(["remote", "add", "origin", "https://git.example.com/code.git"]);
    const docs = path.join(outer, "docs");
    mkdirSync(docs);
    expect(await inspect(home, docs)).toMatchObject({ isRepo: false, remote: null });
  });
});

describe("folderExternalSync", () => {
  it("says what inspectVaultFolder says of the service, there or not yet", async () => {
    const home = scratchHome();
    const synced = path.join(home, "Library", "Mobile Documents", "Notes");
    expect(folderExternalSync(synced, home)).toEqual({ kind: "icloud-drive" });
    mkdirSync(synced, { recursive: true });
    const facts = await inspect(home, synced);
    expect(folderExternalSync(synced, home)).toEqual(facts.externalSync);
    expect(folderExternalSync(path.join(home, "Notes"), home)).toBeNull();
  });
});
