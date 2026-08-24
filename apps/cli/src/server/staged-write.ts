// One spelling for the data dir's atomic file write: stage under a
// pid+random name in the TARGET's own directory (rename is only atomic
// within one filesystem), then rename over the destination. A failed write
// removes its staging file and rethrows the ORIGINAL error, so a
// secret-bearing tmp is never stranded beside the store.

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
      // chmod after write too: writeFileSync's mode applies only on CREATE
      // and is advisory against the umask — a staged file must not carry
      // keys group-readably for even the instant before the rename.
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
