// staged in the target's own directory: rename is only atomic within one
// filesystem. a failed write removes the staging file so a secret-bearing tmp
// is never stranded.

import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import nodePath from "node:path";

export const stagedWriteFileSync = (
  path: string,
  contents: string,
  options?: { mode?: number },
): void => {
  mkdirSync(nodePath.dirname(path), { recursive: true });
  const staged = `${path}.tmp-${String(process.pid)}-${randomBytes(4).toString("hex")}`;
  try {
    const mode = options?.mode;
    if (mode === undefined) {
      writeFileSync(staged, contents, "utf-8");
    } else {
      writeFileSync(staged, contents, { encoding: "utf-8", mode });
      // writeFileSync's mode applies only on create and is subject to the umask.
      chmodSync(staged, mode);
    }
    renameSync(staged, path);
  } catch (error) {
    rmSync(staged, { force: true });
    throw error;
  }
};
