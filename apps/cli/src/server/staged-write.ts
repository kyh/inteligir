// staged in the target's own directory: rename is only atomic within one
// filesystem. a failed write removes the staging file so a secret-bearing tmp
// is never stranded.

import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";

export function stagedWriteFileSync(
  path: string,
  contents: string,
  options?: { mode?: number },
): void {
  mkdirSync(dirname(path), { recursive: true });
  const staged = `${path}.tmp-${String(process.pid)}-${randomBytes(4).toString("hex")}`;
  try {
    const mode = options?.mode;
    if (mode !== undefined) {
      writeFileSync(staged, contents, { encoding: "utf8", mode });
      // writeFileSync's mode applies only on create and is subject to the umask.
      chmodSync(staged, mode);
    } else {
      writeFileSync(staged, contents, "utf8");
    }
    renameSync(staged, path);
  } catch (error) {
    rmSync(staged, { force: true });
    throw error;
  }
}
