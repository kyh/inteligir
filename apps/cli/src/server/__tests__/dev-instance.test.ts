import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCheckoutRoot, resolveDevInstanceId } from "../dev-instance";
import { makeTempDir } from "./temp-dir";

describe("the checkout root", () => {
  it("is the tree's top, whichever directory the process started in", () => {
    // The failure this removes: `pnpm dev` runs the shell from apps/desktop and
    // `pnpm cli …` runs from wherever the developer stands, so hashing the raw
    // cwd hands the CLI a different dev instance than the server it is looking
    // for — and the CLI reports no server while one is plainly running.
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
    // A packaged install has no workspace file above it, and the walk must
    // answer rather than climb to `/` and hash the filesystem root — every
    // install would then share one dev instance.
    const orphan = makeTempDir("inteligir-checkout-test-");
    expect(resolveCheckoutRoot(orphan)).toBe(realpathSync(orphan));
  });
});
