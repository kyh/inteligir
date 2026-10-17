// What one commit stages, planned before git hashes anything: no file over the cap enters
// history, and no commit stages more than COMMIT_BUDGET_BYTES of new bytes, so every push the
// engine makes can be cut into steps the hosted library takes. The plan is read from one status
// and one lstat per dirty path, and applied through a pathspec on stdin, which no argument limit
// bounds, so even a large folder's first commit stages exactly the paths it names.

import { lstat } from "node:fs/promises";
import path from "node:path";
import { VAULT_ASSET_MAX_BYTES } from "@repo/contract/cloud/vault/vault-schema";
import { readPorcelain } from "./git-porcelain";
import type { RunGitCommand } from "./git-run";

// the new bytes one commit may stage; what is past it follows in the next commit at once
export const COMMIT_BUDGET_BYTES = 32 * 1024 * 1024;

// the largest file history keeps: the one cap an item's original, the asset routes and the
// hosted library's reads share
export const HISTORY_FILE_MAX_BYTES = VAULT_ASSET_MAX_BYTES;

// one dirty path as the index and the disk see it
export interface StagingEntry {
  path: string;
  // the index holds the path, so a version of it is (or is about to be) in history
  indexed: boolean;
  // the worktree's size; null when nothing is there, which stages a deletion
  bytes: number | null;
}

export interface SizedPath {
  path: string;
  bytes: number;
}

export interface StagingPlan {
  // what this commit stages: adds, edits and deletions, within the budget's new bytes
  stage: string[];
  // indexed files now over the cap: they leave the index and stay on disk, so the commit that
  // takes them out is a deletion every other device takes
  untrack: SizedPath[];
  // over the cap and not in the index: never staged
  tooLarge: SizedPath[];
  // within the cap, past this commit's budget: the next commit's
  rest: string[];
}

export interface StagingLimits {
  budgetBytes?: number;
  capBytes?: number;
  // paths this commit must not stage, and what is under them (a live turn's claims at its start)
  leaveOut?: ReadonlySet<string>;
}

// whether the path is one of `named` or under one of them, as a pathspec matches a folder
export const coveredBy =
  (named: ReadonlySet<string>) =>
  (filePath: string): boolean => {
    const segments = filePath.split("/");
    for (let depth = 1; depth <= segments.length; depth += 1) {
      if (named.has(segments.slice(0, depth).join("/"))) {
        return true;
      }
    }
    return false;
  };

export const planStaging = (
  entries: readonly StagingEntry[],
  limits: StagingLimits = {},
): StagingPlan => {
  const budget = limits.budgetBytes ?? COMMIT_BUDGET_BYTES;
  const cap = limits.capBytes ?? HISTORY_FILE_MAX_BYTES;
  const plan: StagingPlan = { rest: [], stage: [], tooLarge: [], untrack: [] };
  let spent = 0;
  const leftOut = limits.leaveOut === undefined ? () => false : coveredBy(limits.leaveOut);
  for (const entry of entries) {
    if (leftOut(entry.path)) {
      continue;
    }
    if (entry.bytes === null) {
      plan.stage.push(entry.path);
      continue;
    }
    if (entry.bytes > cap) {
      const sized = { bytes: entry.bytes, path: entry.path };
      (entry.indexed ? plan.untrack : plan.tooLarge).push(sized);
      continue;
    }
    // a commit always takes its first file, which the cap keeps under any budget past it
    if (plan.stage.length > 0 && spent + entry.bytes > budget) {
      plan.rest.push(entry.path);
      continue;
    }
    spent += entry.bytes;
    plan.stage.push(entry.path);
  }
  return plan;
};

// git's index columns: `?` is untracked and `D` a deletion already staged, so neither leaves an
// entry at the path
const indexHolds = (x: string): boolean => x !== "?" && x !== "D";

const sizeOnDisk = async (root: string, filePath: string): Promise<number | null> => {
  try {
    const stats = await lstat(path.join(root, filePath));
    // a folder (an untracked repo inside the vault) stages as git's own entry for it
    return stats.isDirectory() ? 0 : stats.size;
  } catch {
    return null;
  }
};

// past this many paths a scoped read lists the whole tree and keeps the named ones, so no
// argument list bounds what a commit can name
const ARGV_PATHSPEC_MAX = 200;

// every dirty path under `paths` (all of them when absent), one entry each. untracked files are
// listed one by one (`all`), never folded into their folder, so each is measured. --no-renames:
// a staged move is the path it left and the path it made, each staged on its own.
export const readStagingEntries = async (
  run: RunGitCommand,
  root: string,
  paths?: readonly string[],
): Promise<StagingEntry[]> => {
  const argvScoped = paths !== undefined && paths.length <= ARGV_PATHSPEC_MAX;
  const entries = await readPorcelain(run, {
    paths: argvScoped ? paths : [],
    renames: false,
    untracked: "all",
  });
  const keep = paths === undefined || argvScoped ? () => true : coveredBy(new Set(paths));
  const indexed = new Map<string, boolean>();
  for (const entry of entries) {
    if (keep(entry.path)) {
      indexed.set(entry.path, (indexed.get(entry.path) ?? false) || indexHolds(entry.x));
    }
  }
  return await Promise.all(
    [...indexed.entries()].map(async ([filePath, held]) => ({
      bytes: await sizeOnDisk(root, filePath),
      indexed: held,
      path: filePath,
    })),
  );
};

// nul-separated on stdin: a path holding a newline, a quote or a leading dash names only itself
const pathspecInput = (paths: readonly string[]): string => `${paths.join("\0")}\0`;

// the plan's index moves; the commit after them takes the index whole
export const applyStaging = async (
  run: RunGitCommand,
  plan: Pick<StagingPlan, "stage" | "untrack">,
): Promise<void> => {
  if (plan.untrack.length > 0) {
    await run(["rm", "--cached", "-q", "--pathspec-from-file=-", "--pathspec-file-nul"], {
      input: pathspecInput(plan.untrack.map((file) => file.path)),
    });
  }
  if (plan.stage.length > 0) {
    // -A with a pathspec stages deletions under it too
    await run(["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"], {
      input: pathspecInput(plan.stage),
    });
  }
};

// what the commit that takes files out of history says, which every other device's History and
// the online library's show: its basename, or how many when several leave at once
export const untrackSubject = (files: readonly SizedPath[]): string => {
  const [only] = files;
  if (files.length === 1 && only !== undefined) {
    return `${path.posix.basename(only.path)} is over 10 MB, so it stays on this Mac`;
  }
  return `${String(files.length)} files are over 10 MB, so they stay on this Mac`;
};
