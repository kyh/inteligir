import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, onTestFinished } from "vitest";

const suiteDirs: string[] = [];

const remove = (dir: string): void => {
  rmSync(dir, { force: true, recursive: true });
};

afterAll(() => {
  for (const dir of suiteDirs.splice(0)) {
    remove(dir);
  }
});

export interface TempDirOptions {
  // macOS mounts tmpdir under a symlink (/var → /private/var); for suites comparing realpathed outputs.
  realpath?: boolean;
  // `suite` is for a beforeAll fixture, removed after the file's last test.
  lifetime?: "test" | "suite";
}

// macOS's APFS folds case by default and linux's ext4 does not, so a test of case spellings can
// only run where two of them name one folder.
export const TEMP_DIR_FOLDS_CASE = ((): boolean => {
  const upper = tmpdir().toUpperCase();
  return upper !== tmpdir() && existsSync(upper);
})();

export const makeTempDir = (prefix: string, options?: TempDirOptions): string => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  if (options?.lifetime === "suite") {
    suiteDirs.push(dir);
  } else {
    onTestFinished(() => {
      remove(dir);
    });
  }
  return options?.realpath === true ? realpathSync(dir) : dir;
};
