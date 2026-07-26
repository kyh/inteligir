// ---------------------------------------------------------------------------
// pi-quarantine guard: `@earendil-works/pi*` (pi-coding-agent / pi-ai /
// pi-agent-core) may be imported ONLY inside the harness quarantine —
// the packages/agent/src/pi/* wrappers, the faux stub, and two named tests.
// Everything else (agent/*, handlers, delegation, the entire renderer) must
// go through the wrappers, so a future harness swap is bounded to the
// quarantine (see packages/agent/src/pi/README.md, the Harness contract). A
// pi import anywhere else fails here before it can calcify. Mirrors
// account-boundary.test.ts.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

/** Source trees the guard sweeps (product code on every platform) — DERIVED
 * from the filesystem (every `packages/<p>/src` + `apps/<a>/src`, plus
 * `apps/desktop/dev` where the fixture Bridge lives), so a future package or
 * app is swept automatically instead of drifting out of a hand list. */
function scannedDirs(): string[] {
  const dirs: string[] = [];
  for (const parent of ["packages", "apps"]) {
    for (const entry of fs.readdirSync(path.join(REPO_ROOT, parent), { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(path.join(parent, entry.name, "src"));
    }
  }
  dirs.push("apps/desktop/dev");
  return dirs;
}

const SKIP_DIR_NAMES = new Set(["node_modules", "dist", ".cache", ".output", ".expo", "coverage"]);

/** Any module reference into the pi packages (import/export/require/vi.mock —
 * the specifier is what matters, not the syntax around it). Scope-agnostic:
 * matches pi-coding-agent/pi-ai/pi-agent-core under ANY npm scope, so an
 * import of a frozen fork scope — or a future scope move upstream — stays
 * fenced without touching this regex. */
const PI_SPECIFIER = /["']@[a-z0-9-]+\/pi-(?:coding-agent|ai|agent-core)[^"']*["']/;

/** The ONLY places allowed to import pi directly — all inside @repo/agent. */
const ALLOWED = [
  // The harness quarantine: the wrappers everything else goes through.
  "packages/agent/src/pi/",
  // pi-ai's stub provider — part of the provider menu, but pi-shaped.
  "packages/agent/src/provider/faux-provider.ts",
  // Pins gate/tool path-normalization parity against pi's own resolution.
  "packages/agent/src/__tests__/pi-path-parity.test.ts",
  // Drives the faux registration through pi-ai's real register API.
  "packages/agent/src/provider/__tests__/faux-provider.test.ts",
];

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIR_NAMES.has(entry.name)) walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
}

function sourceFiles(): string[] {
  const files: string[] = [];
  for (const dir of scannedDirs()) {
    const abs = path.join(REPO_ROOT, dir);
    if (fs.existsSync(abs)) walk(abs, files);
  }
  return files;
}

function rel(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

describe("pi quarantine (#460)", () => {
  it("only agent/src/pi/*, the faux stub, and the two named tests import @earendil-works/pi*", () => {
    const violations: string[] = [];
    for (const file of sourceFiles()) {
      const relative = rel(file);
      if (ALLOWED.some((allowed) => relative.startsWith(allowed))) continue;
      const content = fs.readFileSync(file, "utf8");
      const match = PI_SPECIFIER.exec(content);
      if (match) violations.push(`${relative} → ${match[0]}`);
    }
    expect(
      violations,
      `pi imported outside the harness quarantine — go through the packages/agent/src/pi/* ` +
        `wrappers (see packages/agent/src/pi/README.md):\n${violations.join("\n")}`,
    ).toEqual([]);
  });
});
