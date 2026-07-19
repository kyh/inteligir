import fs from "node:fs";
import path from "node:path";

/**
 * Recursively copy `src` to `dest` if `dest` does not yet exist. No-op if
 * the destination is already populated — used to seed bundled skills /
 * AGENTS.md / etc. into the user's data dir on first launch.
 *
 * Returns true if the copy happened, false if `dest` already existed or
 * `src` is missing.
 */
export function seedDirectory(src: string, dest: string): boolean {
  if (!fs.existsSync(src)) return false;
  if (fs.existsSync(dest)) return false;
  fs.cpSync(src, dest, { recursive: true });
  return true;
}

/**
 * Copy a single file from `src` to `dest` if `dest` does not yet exist.
 * Creates the parent directory if needed. Returns true if the copy happened,
 * false if `src` is missing or `dest` already existed.
 *
 * Uses COPYFILE_EXCL — atomic "never overwrite" with no TOCTOU window between
 * an existence check and the copy. Matters for sensitive files (OAuth secrets,
 * tokens) where a concurrent launch must not double-write.
 */
export function seedFile(src: string, dest: string): boolean {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
    return true;
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "EEXIST") return false;
    throw err;
  }
}

/**
 * Prepend `entry` to the calling process's PATH if it is not already on it.
 * Idempotent. Used so subprocesses spawned by the agent's bash tool can find
 * binaries we install under `~/.inteligir/bin`.
 */
export function prependPath(entry: string): void {
  const current = process.env["PATH"] ?? "";
  const entries = current.split(path.delimiter).filter(Boolean);
  if (entries.includes(entry)) return;
  process.env["PATH"] = current ? `${entry}${path.delimiter}${current}` : entry;
}
