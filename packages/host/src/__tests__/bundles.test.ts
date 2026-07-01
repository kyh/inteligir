// Drift guard for the static extension-bundle registry: auto-discovery via
// import.meta.glob was dropped (Vite-only), so this test re-checks the disk —
// every agent/<name>/extension.ts must appear in EXTENSION_BUNDLES.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { EXTENSION_BUNDLES } from "../agent/bundles";

const AGENT_DIR = path.resolve(import.meta.dirname, "../agent");

describe("EXTENSION_BUNDLES", () => {
  it("lists every agent/<name>/extension.ts on disk, name-sorted", async () => {
    const dirs = fs
      .readdirSync(AGENT_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(AGENT_DIR, e.name, "extension.ts")))
      .map((e) => e.name)
      .toSorted();

    const bundlesByName = new Map(EXTENSION_BUNDLES.map((b) => [b.name, b]));
    expect([...bundlesByName.keys()].toSorted()).toEqual(dirs);

    // Identity check: the listed bundle IS the folder's default export, not a
    // same-named impostor.
    for (const dir of dirs) {
      const mod: { default: unknown } = await import(`../agent/${dir}/extension.ts`);
      expect(bundlesByName.get(dir)).toBe(mod.default);
    }
  });

  it("is sorted by bundle name for deterministic registration order", () => {
    const names = EXTENSION_BUNDLES.map((b) => b.name);
    expect(names).toEqual([...names].toSorted());
  });
});
