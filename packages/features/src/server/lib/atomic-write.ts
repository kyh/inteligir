// ---------------------------------------------------------------------------
// Atomic file write — the ONE tmp-then-rename dance: write <path>.tmp, then
// rename over the target (atomic on POSIX + NTFS), so a crash mid-write
// leaves the previous file intact instead of a half-written one. Callers
// under ~/.inteligir pass owner-only modes; vault writes pass none
// (user-owned data keeps umask bits).
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";

export type AtomicWriteOptions = {
  /** POSIX bits for the file. Applied to the tmp file with an explicit chmod
   * (writeFileSync's mode applies only on CREATE — a stale crash-leftover tmp
   * would otherwise carry its old, possibly wider, mode through the rename),
   * so the rename carries them to the target unconditionally. Omitted = the
   * process umask default. */
  mode?: number;
  /** When set, create the parent directory first (recursive, these bits). */
  dirMode?: number;
};

/** Write `content` (UTF-8 text or raw bytes) to `filePath` atomically. */
export function atomicWrite(
  filePath: string,
  content: string | Uint8Array,
  options: AtomicWriteOptions = {},
): void {
  if (options.dirMode !== undefined) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: options.dirMode });
  }
  const tmp = `${filePath}.tmp`;
  if (options.mode === undefined) {
    fs.writeFileSync(tmp, content, "utf8");
  } else {
    fs.writeFileSync(tmp, content, { encoding: "utf8", mode: options.mode });
    fs.chmodSync(tmp, options.mode);
  }
  fs.renameSync(tmp, filePath);
}
