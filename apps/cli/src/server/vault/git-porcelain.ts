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

export const readPorcelain = async (
  run: RunGitCommand,
  paths: readonly string[] = [],
): Promise<PorcelainEntry[]> => {
  const pathspec = paths.length === 0 ? [] : ["--", ...paths];
  const { stdout } = await run(["--no-optional-locks", "status", "--porcelain", "-z", ...pathspec]);
  return parsePorcelain(stdout);
};

export const entryPaths = (entries: readonly PorcelainEntry[]): string[] =>
  entries.flatMap((entry) => (entry.origin === null ? [entry.path] : [entry.path, entry.origin]));

// git's unmerged columns: U on either side, AA (both added), DD (both deleted).
export const isUnmerged = (entry: PorcelainEntry): boolean =>
  entry.x === "U" ||
  entry.y === "U" ||
  (entry.x === "A" && entry.y === "A") ||
  (entry.x === "D" && entry.y === "D");
