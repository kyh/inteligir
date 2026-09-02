import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCheckoutRoot, resolveDevInstanceId } from "../dev-instance";
import { makeTempDir } from "./temp-dir";

describe("the checkout root", () => {
  it("is the tree's top, whichever directory the process started in", () => {
    const root = makeTempDir("inteligir-checkout-test-");
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
    const nested = join(root, "apps", "desktop");
    mkdirSync(nested, { recursive: true });

    expect(resolveCheckoutRoot(nested)).toBe(resolveCheckoutRoot(root));
    expect(resolveDevInstanceId(resolveCheckoutRoot(nested))).toBe(
      resolveDevInstanceId(resolveCheckoutRoot(root)),
    );
  });

  it("falls back to where it started when no checkout contains it", () => {
    const orphan = makeTempDir("inteligir-checkout-test-");
    expect(resolveCheckoutRoot(orphan)).toBe(realpathSync(orphan));
  });
});
