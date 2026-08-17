import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureDevDataDirOwnership } from "../data-dir";
import { makeTempDir } from "./temp-dir";

describe("ensureDevDataDirOwnership", () => {
  it("records the checkout on first boot and accepts it thereafter", () => {
    const root = makeTempDir("inteligir-data-dir-test-");
    const dataDir = join(root, "instance");
    ensureDevDataDirOwnership(dataDir, "/checkout/a");
    expect(readFileSync(join(dataDir, "checkout-path"), "utf8").trim()).toBe("/checkout/a");
    expect(() => ensureDevDataDirOwnership(dataDir, "/checkout/a")).not.toThrow();
  });

  it("refuses a data dir recorded for a different checkout", () => {
    const root = makeTempDir("inteligir-data-dir-test-");
    const dataDir = join(root, "instance");
    ensureDevDataDirOwnership(dataDir, "/checkout/a");
    expect(() => ensureDevDataDirOwnership(dataDir, "/checkout/b")).toThrow(
      /belongs to checkout "\/checkout\/a".*INTELIGIR_DATA_DIR/su,
    );
  });
});
