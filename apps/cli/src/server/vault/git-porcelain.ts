import type { RunGitCommand } from "./git-run";

export interface PorcelainEntry {
  x: string;
  y: string;
  path: string;
  origin: string | null;
}

// -z is the format, not an option: git c-quotes paths with spaces or non-ascii bytes in the
// line format, and a second decoder is a file silently left out of a commit.
export const parsePorcelain = (stdout: string): PorcelainEntry[] => {
  const tokens = stdout.split("\0");
  const entries: PorcelainEntry[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    // "XY <path>"; anything shorter is the trailing empty token.
    if (token === undefined || token.length < 4) {
      continue;
    }
    const x = token[0] ?? " ";
    const y = token[1] ?? " ";
    let origin: string | null = null;
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      const from = tokens[index + 1];
      if (from !== undefined && from.length > 0) {
        origin = from;
        index += 1;
      }
    }
    entries.push({ origin, path: token.slice(3), x, y });
  }
  return entries;
};

export interface PorcelainRead {
  // the paths the read is scoped to; all of them when absent
  paths?: readonly string[];
  // "all" lists every untracked file on its own, never folded into its folder, for a reader that
  // measures each one (a commit's plan)
  untracked?: "normal" | "all";
  // false reads a staged move as the path it left and the path it made
  renames?: boolean;
}

export const readPorcelain = async (
  run: RunGitCommand,
  read: PorcelainRead = {},
): Promise<PorcelainEntry[]> => {
  const pathspec = read.paths === undefined || read.paths.length === 0 ? [] : ["--", ...read.paths];
  // explicit, because a vault's status.showUntrackedFiles=no hides every new note from a commit.
  const { stdout } = await run([
    "--no-optional-locks",
    "status",
    "--porcelain",
    "-z",
    `--untracked-files=${read.untracked ?? "normal"}`,
    ...(read.renames === false ? ["--no-renames"] : []),
    ...pathspec,
  ]);
  return parsePorcelain(stdout);
};

// git's unmerged columns: U on either side, AA (both added), DD (both deleted).
const isUnmerged = (entry: PorcelainEntry): boolean =>
  entry.x === "U" ||
  entry.y === "U" ||
  (entry.x === "A" && entry.y === "A") ||
  (entry.x === "D" && entry.y === "D");

export const unmergedPaths = async (run: RunGitCommand): Promise<string[]> => {
  const entries = await readPorcelain(run);
  return entries
    .filter(isUnmerged)
    .map((entry) => entry.path)
    .toSorted();
};
