import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureDevDataDirOwnership } from "../data-dir";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "inteligir-data-dir-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("ensureDevDataDirOwnership", () => {
  it("records the checkout on first boot and accepts it thereafter", () => {
    const root = makeTempDir();
    const dataDir = join(root, "instance");
    ensureDevDataDirOwnership(dataDir, "/checkout/a");
    expect(readFileSync(join(dataDir, "checkout-path"), "utf8").trim()).toBe("/checkout/a");
    expect(() => ensureDevDataDirOwnership(dataDir, "/checkout/a")).not.toThrow();
  });

  it("refuses a data dir recorded for a different checkout", () => {
    const root = makeTempDir();
    const dataDir = join(root, "instance");
    ensureDevDataDirOwnership(dataDir, "/checkout/a");
    expect(() => ensureDevDataDirOwnership(dataDir, "/checkout/b")).toThrow(
      /belongs to checkout "\/checkout\/a".*INTELIGIR_DATA_DIR/su,
    );
  });
});
