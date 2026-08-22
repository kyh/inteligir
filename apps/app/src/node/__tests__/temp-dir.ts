import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A fresh temp dir, removed automatically after the current test.
 *  `realpath` resolves the created dir (macOS /var → /private/var) for a
 *  suite whose assertions compare realpathed outputs against it. */
export function makeTempDir(prefix: string, options?: { realpath?: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return options?.realpath === true ? realpathSync(dir) : dir;
}
