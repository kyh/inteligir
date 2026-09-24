import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { noopNotifier } from "@repo/domain/notifier";
import { createVaultIgnore } from "@repo/notes/knowledge/vault-ignore";
import type { VaultIgnore } from "@repo/notes/knowledge/vault-ignore";
import { describe, expect, it } from "vitest";
import { ensureVaultRepo } from "../git-bootstrap";
import { runGit } from "../git-run";
import type { RunGitCommand } from "../git-run";
import { createVaultIgnoreHolder, loadVaultIgnore, readIgnoreCase } from "../vault-ignore-files";
import { createVaultService } from "../vault-service";
import type { VaultService } from "../vault-service";
import { identityLock } from "../../__tests__/identity-lock";
import { makeTempDir } from "../../__tests__/temp-dir";
import { hermeticGitEnv } from "./git-test-env";

const env = hermeticGitEnv();

const writeTree = (root: string, files: Record<string, string>): void => {
  for (const [relPath, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, relPath)), { recursive: true });
    writeFileSync(path.join(root, relPath), content);
  }
};

const bootRepo = async () => {
  const root = makeTempDir("inteligir-vault-ignore-", { realpath: true });
  await ensureVaultRepo({ env, root });
  const git: RunGitCommand = async (gitArgs) => await runGit(root, gitArgs, { env });
  return { git, root };
};

const listedPaths = async (service: VaultService, kind?: "file"): Promise<string[]> => {
  const { entries } = await service.listTree();
  return entries
    .filter((entry) => kind === undefined || entry.kind === kind)
    .map((entry) => entry.path);
};

const rulesNaming = (folder: string): VaultIgnore =>
  createVaultIgnore([{ content: `${folder}/\n`, dir: "" }], { ignoreCase: false });

describe("the listing against git's own reading of the same .gitignore files", () => {
  it(
    "lists exactly the files git calls untracked and not ignored",
    { timeout: 20_000 },
    async () => {
      const { git, root } = await bootRepo();
      writeTree(root, {
        ".gitignore": "node_modules/\n*.log\n!keep.log\nbuild/\n",
        "build/.gitignore": "!x.md\n",
        "build/x.md": "re-included by a file git never reads\n",
        "cache/.gitignore": "*\n",
        "cache/a.md": "a\n",
        "cache/deep/b.md": "b\n",
        "cachet/c.md": "c\n",
        "debug.log": "noise\n",
        "docs/.gitignore": "!important.log\n/drafts/\n",
        "docs/deep/drafts/kept.md": "anchored rules stop at their own folder\n",
        "docs/drafts/wip.md": "wip\n",
        "docs/guide.md": "guide\n",
        "docs/important.log": "kept by the deeper rule\n",
        "docs/other.log": "noise\n",
        "keep.log": "kept\n",
        "node_modules/pkg/.gitignore": "!README.md\n",
        "node_modules/pkg/README.md": "vendored\n",
        "note.md": "note\n",
        "site/.gitignore": "# built\n/out\n",
        "site/out/index.md": "built\n",
        "site/pages/out/kept.md": "not the anchored one\n",
        "two words/note.md": "spaced\n",
      });
      const ignoreCase = await readIgnoreCase(git);
      const service = createVaultService({
        ignore: async () => await loadVaultIgnore(root, { ignoreCase }),
        lock: identityLock,
        notifier: noopNotifier,
        root,
      });

      const files = await listedPaths(service, "file");
      const listed = files.toSorted();
      // no global excludes file: the vault's own .gitignore files are the question
      const { stdout } = await git([
        "-c",
        "core.excludesFile=/dev/null",
        "ls-files",
        "-z",
        "--others",
        "--exclude-standard",
      ]);
      const untracked = stdout
        .split("\0")
        .filter((line) => line !== "")
        .toSorted();

      expect(listed).toEqual(untracked);
      expect(listed).toContain("docs/important.log");
      expect(listed).not.toContain("node_modules/pkg/README.md");
      expect(listed).not.toContain("cache/a.md");
    },
  );
});

describe("the vault service over the rules", () => {
  it("answers no row, no stat and no file for a folder the .gitignore names", async () => {
    const { root } = await bootRepo();
    writeTree(root, {
      ".gitignore": "node_modules/\n",
      "node_modules/pkg/README.md": "vendored\n",
      "note.md": "note\n",
    });
    const service = createVaultService({
      ignore: async () => await loadVaultIgnore(root, { ignoreCase: false }),
      lock: identityLock,
      notifier: noopNotifier,
      root,
    });

    const paths = await listedPaths(service);
    expect(paths.filter((entryPath) => entryPath.startsWith("node_modules"))).toEqual([]);
    expect(await service.statEntry("node_modules")).toBeNull();
    expect(await service.statEntry("node_modules/pkg/README.md")).toBeNull();
    expect(await service.listFilesUnder("node_modules")).toEqual([]);
    expect(await service.statEntry("note.md")).toBe("file");
    // a read is by path, not a listing: the file is still the user's to open
    const { content } = await service.read("node_modules/pkg/README.md");
    expect(content).toBe("vendored\n");
  });

  it("lists everything but the floor when the vault has no .gitignore", async () => {
    const { root } = await bootRepo();
    writeTree(root, { "dist/out.md": "built\n", "node_modules/pkg/README.md": "vendored\n" });
    const service = createVaultService({
      ignore: async () => await loadVaultIgnore(root, { ignoreCase: false }),
      lock: identityLock,
      notifier: noopNotifier,
      root,
    });

    expect(await listedPaths(service)).toEqual([
      "dist",
      "dist/out.md",
      "node_modules",
      "node_modules/pkg",
      "node_modules/pkg/README.md",
    ]);
  });
});

describe("readIgnoreCase", () => {
  it("answers the repo's core.ignorecase, and git's false when it is unset", async () => {
    const { git } = await bootRepo();
    await git(["config", "core.ignorecase", "true"]);
    expect(await readIgnoreCase(git)).toBe(true);
    await git(["config", "--unset", "core.ignorecase"]);
    expect(await readIgnoreCase(git)).toBe(false);
  });
});

describe("the rules holder", () => {
  it("answers the newest load, and never lets an older one finishing late replace it", async () => {
    const loads: PromiseWithResolvers<VaultIgnore>[] = [];
    const holder = createVaultIgnoreHolder(
      async () => {
        const load = Promise.withResolvers<VaultIgnore>();
        loads.push(load);
        return await load.promise;
      },
      createVaultIgnore([], { ignoreCase: false }),
    );
    expect(holder.settled().ignores("first/a.md", "file")).toBe(false);

    holder.reload();
    const current = holder.current();
    loads[1]?.resolve(rulesNaming("second"));
    const newest = await current;
    expect(newest.ignores("second/a.md", "file")).toBe(true);
    loads[0]?.resolve(rulesNaming("first"));
    await nextTurn();

    expect(holder.settled().ignores("second/a.md", "file")).toBe(true);
    expect(holder.settled().ignores("first/a.md", "file")).toBe(false);
  });
});
