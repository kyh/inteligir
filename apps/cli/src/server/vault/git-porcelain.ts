// One responsibility: `git status --porcelain` — the ONE invocation and the
// ONE decode of what comes back. Every caller that wants to know what the
// working tree holds goes through this module, so the format and its reading
// cannot drift apart.

import type { RunGitCommand } from "./git-run";

/** One entry of `git status --porcelain`: the two status columns, the path,
 *  and — for a rename or copy — the path it came FROM. */
export interface PorcelainEntry {
  x: string;
  y: string;
  path: string;
  origin: string | null;
}

/**
 * THE reader of `git status --porcelain`, and the only one —
 * one-spelling.test.ts holds every other caller to it. git C-QUOTES any path
 * holding a space or a non-ASCII byte in the line format (`"a\tb"`), so a
 * second decoder is a file silently left out of a commit.
 *
 * `-z` is not an option here, it is the format: NUL-separated, never quoted,
 * with a rename's origin arriving as its own token. Every caller runs it, and
 * this is the one place that knows what comes back.
 */
export function parsePorcelain(stdout: string): PorcelainEntry[] {
  const tokens = stdout.split("\0");
  const entries: PorcelainEntry[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    // `XY <path>`: two status columns, a space, then the path. Anything
    // shorter is the trailing empty token, not an entry.
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
    entries.push({ x, y, path: token.slice(3), origin });
  }
  return entries;
}

/** The ONE invocation. Pathspecs narrow it; the format never varies. */
export async function readPorcelain(
  run: RunGitCommand,
  paths: readonly string[] = [],
): Promise<PorcelainEntry[]> {
  const pathspec = paths.length === 0 ? [] : ["--", ...paths];
  const { stdout } = await run(["--no-optional-locks", "status", "--porcelain", "-z", ...pathspec]);
  return parsePorcelain(stdout);
}

/** The paths a status entry names — BOTH sides of a rename, because both
 *  belong to the commit that carries it. */
export function entryPaths(entries: readonly PorcelainEntry[]): string[] {
  return entries.flatMap((entry) =>
    entry.origin === null ? [entry.path] : [entry.path, entry.origin],
  );
}

/** The two status columns git uses for a halted merge: the honest conflict
 *  set, read from the rebase before it is aborted. */
export function isUnmerged(entry: PorcelainEntry): boolean {
  return (
    entry.x === "U" ||
    entry.y === "U" ||
    (entry.x === "A" && entry.y === "A") ||
    (entry.x === "D" && entry.y === "D")
  );
}
