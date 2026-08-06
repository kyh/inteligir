// ---------------------------------------------------------------------------
// Teardown-completeness guard: teardownAgentResources (boot/agent-wiring.ts)
// is the FULL ~/.inteligir wipe — every exported singleton teardown
// (`reset*`/`dispose*`) across packages/*/src must be reachable from it,
// directly or via a cascaded reset. A singleton missed there survives the
// wipe with warm JsonStore caches or open sqlite handles pointed at deleted
// files (soft leak on POSIX, hard rm failure on Windows). Mirrors
// account-boundary.test.ts: walk the source, assert the invariant.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const TEARDOWN_FILE = path.join(REPO_ROOT, "packages/server/src/boot/agent-wiring.ts");

/** Teardowns NOT called by name in agent-wiring.ts, with the reason each is
 * still covered (or exempt). Adding here requires the same justification. */
const ALLOWED_ABSENT = new Set([
  // Test-only seam: clears the faux provider's scripted responses between
  // tests — no store cache or handle, nothing to leak across a wipe.
  "resetFauxResponses",
]);

const SKIP_DIR_NAMES = new Set(["node_modules", "dist", ".cache", ".output", ".expo", "coverage"]);

const TEARDOWN_EXPORT = /export function ((?:reset|dispose)[A-Z][A-Za-z]*)\(/g;

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIR_NAMES.has(entry.name) && entry.name !== "__tests__") walk(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
}

/** Every `<pkg>/src` under packages/ — derived, so a new package is swept
 * automatically instead of waiting for someone to extend a hand list. */
function packageSourceDirs(): string[] {
  const packagesDir = path.join(REPO_ROOT, "packages");
  return fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesDir, entry.name, "src"))
    .filter((dir) => fs.existsSync(dir));
}

describe("teardown completeness", () => {
  it("every exported reset*/dispose* singleton teardown is reachable from teardownAgentResources", () => {
    const teardownBody = fs.readFileSync(TEARDOWN_FILE, "utf8");
    const missing: string[] = [];
    for (const dir of packageSourceDirs()) {
      const files: string[] = [];
      walk(dir, files);
      for (const file of files) {
        const content = fs.readFileSync(file, "utf8");
        for (const match of content.matchAll(TEARDOWN_EXPORT)) {
          const name = match[1];
          if (name === undefined || ALLOWED_ABSENT.has(name)) continue;
          if (!teardownBody.includes(`${name}()`)) {
            missing.push(`${name} (${path.relative(REPO_ROOT, file).split(path.sep).join("/")})`);
          }
        }
      }
    }
    expect(
      missing,
      `Singleton teardowns missing from teardownAgentResources (boot/agent-wiring.ts) — ` +
        `call them there, or add to ALLOWED_ABSENT with a covered-elsewhere reason:\n${missing.join("\n")}`,
    ).toEqual([]);
  });
});
