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
 * Write `content` to `dest` if `dest` does not yet exist — seedFile for a file
 * the caller COMPOSES rather than copies. Same never-overwrite guarantee, from
 * the same atomic primitive (`wx` is O_EXCL), so a concurrent launch cannot
 * double-write and a file the user has edited is never clobbered.
 */
export function seedContent(dest: string, content: string): boolean {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.writeFileSync(dest, content, { flag: "wx" });
    return true;
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "EEXIST") return false;
    throw err;
  }
}

/**
 * Keep a GENERATED region of a file current without touching the rest of it.
 *
 * The counterpart to `seedContent` for a file that is part ours and part the
 * user's: their prose is never rewritten, but a section we generate would
 * otherwise be frozen at whatever the first launch wrote — so an install that
 * predates the section never gets it, and one that has it never sees a change.
 *
 * Absent file: the caller's `fallback` is written whole. Markers present: only
 * the span between them is replaced. Markers absent from an existing file: the
 * section is appended, so a hand-edited file adopts it rather than being
 * rebuilt.
 */
export function syncManagedSection(
  dest: string,
  marker: string,
  section: string,
  fallback: string,
): void {
  const open = `<!-- ${marker}:start -->`;
  const close = `<!-- ${marker}:end -->`;
  const block = `${open}\n${section.trim()}\n${close}`;

  let existing: string;
  try {
    existing = fs.readFileSync(dest, "utf8");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      seedContent(dest, fallback);
      return;
    }
    throw err;
  }

  const from = existing.indexOf(open);
  const to = existing.indexOf(close);
  const next =
    from !== -1 && to > from
      ? existing.slice(0, from) + block + existing.slice(to + close.length)
      : `${existing.trimEnd()}\n\n${block}\n`;
  if (next !== existing) fs.writeFileSync(dest, next);
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
