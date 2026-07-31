// Drift guard for the static extension-bundle registry: nothing
// auto-discovers bundles (import.meta.glob is Vite-only), so the list is
// hand-maintained and this test re-checks it against the disk — every
// agent/<name>/extension.ts must appear in EXTENSION_BUNDLES.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { EXTENSION_BUNDLES } from "../bundles";

const AGENT_DIR = path.resolve(import.meta.dirname, "..");

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
      const mod: { default: unknown } = await import(`../${dir}/extension.ts`);
      expect(bundlesByName.get(dir)).toBe(mod.default);
    }
  });

  it("is sorted by bundle name for deterministic registration order", () => {
    const names = EXTENSION_BUNDLES.map((b) => b.name);
    expect(names).toEqual([...names].toSorted());
  });

  // pi hands every `tool_call` handler the SAME mutable `input` object and
  // re-validates nothing after the chain runs, so a second handler could
  // rewrite the path the privacy gate just probed and the tool would execute
  // against a note the gate never saw. Privacy being the only subscriber is
  // what makes that unreachable — this pins it. Source-text, so a handler
  // registered indirectly would slip past; it catches the ordinary case.
  it("registers exactly one tool_call subscriber — the privacy gate", () => {
    const subscribers = fs
      .readdirSync(AGENT_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(AGENT_DIR, e.name, "extension.ts")))
      .filter((e) =>
        fs
          .readdirSync(path.join(AGENT_DIR, e.name), { recursive: true })
          .filter((f): f is string => typeof f === "string" && f.endsWith(".ts"))
          .some((f) =>
            fs.readFileSync(path.join(AGENT_DIR, e.name, f), "utf8").includes('on("tool_call"'),
          ),
      )
      .map((e) => e.name)
      .toSorted();

    expect(
      subscribers,
      "A second tool_call subscriber shares one mutable `input` with the privacy gate and pi\n" +
        "does not re-validate between handlers — whichever runs after the gate can redirect the\n" +
        "call to an unprobed path. Before allowing one: prove it cannot mutate `input`, and pin\n" +
        "the ordering so privacy runs last.",
    ).toEqual(["privacy"]);
  });
});
