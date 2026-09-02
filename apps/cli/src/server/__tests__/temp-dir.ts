import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, onTestFinished } from "vitest";

const suiteDirs: string[] = [];

afterAll(() => {
  for (const dir of suiteDirs.splice(0)) remove(dir);
});

function remove(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export interface TempDirOptions {
  /** Resolve the created dir (macOS /var → /private/var) for a suite whose
   *  assertions compare realpathed outputs against it. */
  realpath?: boolean;
  /** `test` (the default) removes the dir when the current test finishes —
   *  registered before anything created inside it, so it runs after them.
   *  `suite` is for a `beforeAll` fixture, removed after the file's last test. */
  lifetime?: "test" | "suite";
}

/** A fresh temp dir, removed automatically. */
export function makeTempDir(prefix: string, options?: TempDirOptions): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  if (options?.lifetime === "suite") {
    suiteDirs.push(dir);
  } else {
    onTestFinished(() => remove(dir));
  }
  return options?.realpath === true ? realpathSync(dir) : dir;
}
