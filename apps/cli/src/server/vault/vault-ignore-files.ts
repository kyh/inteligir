// The server's reading of every .gitignore in the vault. Git reads one only in a folder it
// enters, so a folder the rules above it ignore is never entered here, and a rules file inside it
// is never read.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createVaultIgnore, GITIGNORE_NAME } from "@repo/notes/knowledge/vault-ignore";
import type { VaultIgnore, VaultIgnoreOptions } from "@repo/notes/knowledge/vault-ignore";
import type { RunGitCommand } from "./git-run";

// an unreadable folder or rules file holds no rules: the listing's own walk reports the folder,
// and a load that threw would cost every listing until the next reload.
export const loadVaultIgnore = async (
  root: string,
  options: VaultIgnoreOptions,
): Promise<VaultIgnore> => {
  let rules = createVaultIgnore([], options);
  const visit = async (absDir: string, relDir: string): Promise<void> => {
    const dirents = await readdir(absDir, { withFileTypes: true }).catch(() => []);
    if (dirents.some((dirent) => dirent.name === GITIGNORE_NAME && dirent.isFile())) {
      const content = await readFile(path.join(absDir, GITIGNORE_NAME), "utf-8").catch(() => null);
      if (content !== null) {
        rules = rules.with({ content, dir: relDir });
      }
    }
    for (const dirent of dirents) {
      const relPath = relDir === "" ? dirent.name : `${relDir}/${dirent.name}`;
      // lstat semantics, as in the listing: a symlinked folder is never followed out of the vault
      if (dirent.isDirectory() && !rules.ignores(relPath, "dir")) {
        await visit(path.join(absDir, dirent.name), relPath);
      }
    }
  };
  await visit(root, "");
  return rules;
};

// `git init` probes the filesystem and records the answer; an unset key is git's own false.
export const readIgnoreCase = async (run: RunGitCommand): Promise<boolean> => {
  try {
    const { stdout } = await run(["config", "--type=bool", "--get", "core.ignorecase"]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
};

export interface VaultIgnoreHolder {
  // the newest load, awaited while it runs, so a listing never answers from rules a reload is
  // replacing
  current: () => Promise<VaultIgnore>;
  // the newest load that finished, for a caller that cannot wait
  settled: () => VaultIgnore;
  reload: () => void;
}

export const createVaultIgnoreHolder = (
  load: () => Promise<VaultIgnore>,
  beforeFirstLoad: VaultIgnore,
): VaultIgnoreHolder => {
  let started = 0;
  let settledGeneration = 0;
  let settled = beforeFirstLoad;
  const start = async (): Promise<VaultIgnore> => {
    started += 1;
    const generation = started;
    const rules = await load();
    // an older load finishing late must not replace a newer one's rules
    if (generation > settledGeneration) {
      settledGeneration = generation;
      settled = rules;
    }
    return rules;
  };
  let loading = start();
  return {
    current: async () => await loading,
    reload: () => {
      loading = start();
    },
    settled: () => settled,
  };
};
