// A pass whose rebase stopped on a path both devices changed merges instead, and never stops:
// git merges every path it can, and each one it cannot gets `reconcileFile`'s verdict, the one the
// phone's write queue lands for the same inputs. Every verdict lands through the index, as a blob
// checked out from there, never a write into the vault from here, so the tree the merge commits is
// exactly the one on disk.

import { takenIgnoringCase } from "@repo/notes/knowledge/doc-file";
import { deviceLabel } from "@repo/notes/sync/conflict-copy";
import type { SyncConflictReport } from "@repo/notes/sync/conflict-copy";
import type { FileSide, Reconciled, ReconcileInput } from "@repo/notes/sync/reconcile-file";
import { identityEnv } from "./git-run";
import type { RunGitOptions } from "./git-run";

interface MergeGit {
  run: (gitArgs: readonly string[], options?: RunGitOptions) => Promise<{ stdout: string }>;
  readBlob: (oid: string) => Promise<Uint8Array>;
}

export type Reconcile = (input: ReconcileInput) => Reconciled;

interface MergeFetchedArgs {
  remoteRef: string;
  // this device's name: the merge commit's committer and the side whose version stays
  device: string;
  reconcile: Reconcile;
}

// the vault's own habits must not decide a merge: a recorded rerere resolution would land instead
// of the verdict, and a signature policy would refuse every merge. renames are followed, so an
// edit here and a move there land as one note.
const MERGE_CONFIG = [
  "-c",
  "rerere.enabled=false",
  "-c",
  "merge.renames=true",
  "-c",
  "merge.verifySignatures=false",
  "-c",
  "commit.gpgsign=false",
];

// the modes git stores a regular file under; a symlink or a submodule is never a note, so it keeps
// this device's entry and is never copied.
const FILE_MODES = new Set(["100644", "100755"]);
const DEFAULT_FILE_MODE = "100644";

interface StageEntry {
  mode: string;
  oid: string;
}

interface UnmergedPath {
  path: string;
  base: StageEntry | null;
  mine: StageEntry | null;
  theirs: StageEntry | null;
}

export const mergeInProgress = async (git: Pick<MergeGit, "run">): Promise<boolean> => {
  try {
    await git.run(["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
    return true;
  } catch {
    return false;
  }
};

const zeroSeparated = (stdout: string): string[] =>
  stdout.split("\0").filter((entry) => entry.length > 0);

const gitLines = async (git: MergeGit, gitArgs: readonly string[]): Promise<string[]> => {
  const { stdout } = await git.run(gitArgs);
  return zeroSeparated(stdout);
};

// `ls-files -u -z`: "<mode> <oid> <stage>\t<path>" per entry, stage 1 the base, 2 this side, 3 theirs.
const readUnmerged = async (git: MergeGit): Promise<UnmergedPath[]> => {
  const byPath = new Map<string, UnmergedPath>();
  for (const record of await gitLines(git, ["ls-files", "-u", "-z"])) {
    const tab = record.indexOf("\t");
    if (tab === -1) {
      continue;
    }
    const [mode, oid, stage] = record.slice(0, tab).split(" ");
    const path = record.slice(tab + 1);
    if (mode === undefined || oid === undefined || path === "") {
      continue;
    }
    const entry = byPath.get(path) ?? { base: null, mine: null, path, theirs: null };
    const side = { mode, oid };
    if (stage === "1") {
      entry.base = side;
    } else if (stage === "2") {
      entry.mine = side;
    } else if (stage === "3") {
      entry.theirs = side;
    }
    byPath.set(path, entry);
  }
  return [...byPath.values()].toSorted((a, b) => (a.path < b.path ? -1 : 1));
};

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const readSide = async (git: MergeGit, entry: StageEntry | null): Promise<FileSide> => {
  if (entry === null) {
    return { kind: "absent" };
  }
  const bytes = await git.readBlob(entry.oid);
  try {
    return { kind: "text", text: utf8.decode(bytes) };
  } catch {
    return { kind: "opaque", ref: entry.oid };
  }
};

const plural = (count: number, noun: string): string =>
  `${String(count)} ${count === 1 ? noun : `${noun}s`}`;

// whose version a path's other side is: the committer of the newest commit since the two sides
// parted that touched it, else of their tip.
const otherDevices = async (git: MergeGit, remoteRef: string) => {
  const committerOf = async (range: readonly string[]): Promise<string> => {
    const { stdout } = await git.run(["log", "-1", "--format=%cn", ...range]);
    return stdout.trim();
  };
  const tip = await committerOf([remoteRef]);
  const base = await git
    .run(["merge-base", "HEAD", remoteRef])
    .then(({ stdout }) => stdout.trim())
    .catch(() => null);
  return {
    of: async (path: string): Promise<string> => {
      const touched = base === null ? "" : await committerOf([`${base}..${remoteRef}`, "--", path]);
      return touched === "" ? tip : touched;
    },
    tip,
  };
};

// every write goes into the index first and out to the worktree from there. -u records what the
// checkout wrote: an entry --cacheinfo made carries no stat, and a merge --abort refuses one as
// not up to date.
const indexWriter = (git: MergeGit) => {
  const land = async (path: string, entry: StageEntry): Promise<void> => {
    await git.run(["update-index", "--add", "--cacheinfo", entry.mode, entry.oid, path]);
    await git.run(["checkout-index", "-f", "-u", "--", path]);
  };
  return {
    land,
    async landText(path: string, text: string, mode: string): Promise<void> {
      const { stdout } = await git.run(["hash-object", "-w", "--no-filters", "--stdin"], {
        input: text,
      });
      await land(path, { mode, oid: stdout.trim() });
    },
    async remove(path: string): Promise<void> {
      await git.run(["rm", "-q", "-f", "--", path]);
    },
  };
};

type IndexWriter = ReturnType<typeof indexWriter>;

const landVerdict = async (
  write: IndexWriter,
  { path, mine, theirs }: UnmergedPath,
  { stays, copy }: Reconciled,
): Promise<void> => {
  if (stays.kind === "mine" && mine !== null) {
    await write.land(path, mine);
  } else if (stays.kind === "theirs" && theirs !== null) {
    await write.land(path, theirs);
  } else if (stays.kind === "merged") {
    await write.landText(path, stays.text, mine?.mode ?? theirs?.mode ?? DEFAULT_FILE_MODE);
  } else {
    await write.remove(path);
  }
  if (copy !== null) {
    const mode = theirs?.mode ?? DEFAULT_FILE_MODE;
    await (copy.kind === "text"
      ? write.landText(copy.path, copy.text, mode)
      : write.land(copy.path, { mode, oid: copy.ref }));
  }
};

// exiting non-zero with MERGE_HEAD written is git stopping on paths it could not merge; true once
// a merge waits to be committed, false when there was nothing to merge.
const startMerge = async (git: MergeGit, { device, remoteRef }: MergeFetchedArgs) => {
  try {
    await git.run(
      [
        ...MERGE_CONFIG,
        "merge",
        "--no-ff",
        "--no-commit",
        "--allow-unrelated-histories",
        remoteRef,
      ],
      { env: { ...identityEnv(device), GIT_MERGE_AUTOEDIT: "no" } },
    );
  } catch (error) {
    if (!(await mergeInProgress(git))) {
      throw error;
    }
  }
  return await mergeInProgress(git);
};

const mergeAndSettle = async (
  git: MergeGit,
  args: MergeFetchedArgs,
): Promise<SyncConflictReport[]> => {
  if (!(await startMerge(git, args))) {
    return [];
  }
  const { device, reconcile, remoteRef } = args;
  const devices = await otherDevices(git, remoteRef);
  const takenInTips = takenIgnoringCase([
    ...(await gitLines(git, ["ls-tree", "-r", "-z", "--name-only", "HEAD"])),
    ...(await gitLines(git, ["ls-tree", "-r", "-z", "--name-only", remoteRef])),
  ]);
  const copiesMade: string[] = [];
  const isTaken = (candidate: string): boolean =>
    takenInTips(candidate) || takenIgnoringCase(copiesMade)(candidate);
  const write = indexWriter(git);

  const reports: SyncConflictReport[] = [];
  for (const entry of await readUnmerged(git)) {
    const { path, mine } = entry;
    const sides = [entry.base, mine, entry.theirs];
    if (sides.some((side) => side !== null && !FILE_MODES.has(side.mode))) {
      await (mine === null ? write.remove(path) : write.land(path, mine));
      continue;
    }
    const verdict = reconcile({
      base: await readSide(git, entry.base),
      isTaken,
      mine: await readSide(git, mine),
      path,
      theirDevice: await devices.of(path),
      theirs: await readSide(git, entry.theirs),
      thisDevice: device,
    });
    await landVerdict(write, entry, verdict);
    if (verdict.copy !== null) {
      copiesMade.push(verdict.copy.path);
    }
    if (verdict.report !== null) {
      reports.push(verdict.report);
    }
  }

  const unresolved = await readUnmerged(git);
  if (unresolved.length > 0) {
    throw new Error("the merge left paths unresolved");
  }
  const changed = await gitLines(git, [
    "diff",
    "--cached",
    "--name-only",
    "-z",
    "--no-renames",
    "HEAD",
    "--",
  ]);
  const subject = `vault: merge ${plural(changed.length, "note")} from ${deviceLabel(devices.tip)}`;
  await git.run(["-c", "commit.gpgsign=false", "commit", "-q", "-m", subject], {
    env: identityEnv(device),
  });
  return reports;
};

// answers what was settled here, one report per path whose two versions could not both stay.
// whatever throws leaves the repo on the head it started from.
export const mergeFetched = async (
  git: MergeGit,
  args: MergeFetchedArgs,
): Promise<SyncConflictReport[]> => {
  try {
    return await mergeAndSettle(git, args);
  } catch (error) {
    await git.run(["merge", "--abort"]).catch(() => {
      // no merge was started, or none is left to abort: the caller checks MERGE_HEAD itself.
    });
    throw error;
  }
};
