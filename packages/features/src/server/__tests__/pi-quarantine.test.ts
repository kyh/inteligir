// ---------------------------------------------------------------------------
// pi-quarantine guard (#460): `@mariozechner/pi*` (pi-coding-agent / pi-ai)
// may be imported ONLY inside the harness quarantine — the server/pi/*
// wrappers, the faux stub, and two named tests. Everything else (agent/*,
// handlers, delegation, the entire renderer) must go through the wrappers,
// so a future harness swap is bounded to the quarantine (see
// server/pi/README.md, the Harness contract). A pi import anywhere else
// fails here before it can calcify. Mirrors account-boundary.test.ts.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../../../..");

/** Source trees the guard sweeps (product code on every platform). */
const SCANNED_DIRS = [
  "packages/bridge/src",
  "packages/cli-bootstrap/src",
  "packages/features/src",
  "packages/domain/src",
  "packages/ui/src",
  "apps/desktop/src",
  "apps/desktop/dev",
  "apps/mobile/src",
  "apps/web/src",
];

const SKIP_DIR_NAMES = new Set(["node_modules", "dist", ".cache", ".output", ".expo", "coverage"]);

/** Any module reference into the pi packages (import/export/require/vi.mock —
 * the specifier is what matters, not the syntax around it). */
const PI_SPECIFIER = /["']@mariozechner\/pi[^"']*["']/;

/** The ONLY places allowed to import pi directly. */
const ALLOWED = [
  // The harness quarantine: the wrappers everything else goes through.
  "packages/features/src/server/pi/",
  // pi-ai's stub provider — part of the provider menu, but pi-shaped.
  "packages/features/src/server/provider/faux-provider.ts",
  // Pins gate/tool path-normalization parity against pi's own resolution.
  "packages/features/src/server/__tests__/pi-path-parity.test.ts",
  // Drives the faux registration through pi-ai's real register API.
  "packages/features/src/server/provider/__tests__/faux-provider.test.ts",
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
  for (const dir of SCANNED_DIRS) {
    const abs = path.join(REPO_ROOT, dir);
    if (fs.existsSync(abs)) walk(abs, files);
  }
  return files;
}

function rel(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

describe("pi quarantine (#460)", () => {
  it("only server/pi/*, the faux stub, and the two named tests import @mariozechner/pi*", () => {
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
      `pi imported outside the harness quarantine — go through the server/pi/* wrappers ` +
        `(see server/pi/README.md):\n${violations.join("\n")}`,
    ).toEqual([]);
  });
});
