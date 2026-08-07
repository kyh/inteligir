// ---------------------------------------------------------------------------
// pi quarantine. `apps/web/container/src/pi/` is the ONLY place allowed to name
// `@earendil-works/pi-*`; everything else in the image speaks the container's
// own vocabulary (`ContainerTool`, `AgentReport`, `ContainerTurn`).
//
// pi moves fast, and an import that leaks upward turns every export rename into
// a change across the daemon, the reporter and the tool relays. The container
// package has no test script of its own and no lint override names pi, so
// without this the rule was a sentence in a README that a violation would ship
// straight past.
//
// Import specifiers only — `src/tools.ts` names pi in prose, explaining the
// vocabulary it exists to keep, and a guard that counted that would forbid the
// comment rather than the coupling.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const CONTAINER_SRC = path.join(REPO_ROOT, "apps/web/container/src");
const QUARANTINE = path.join(CONTAINER_SRC, "pi");

/** A pi module specifier in an import/require/dynamic import. */
const PI_IMPORT = /(?:^|[\s(])(?:import|require)[^\n]*?["'](@earendil-works\/pi-[^"']*)["']/m;

function sourceFiles(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
}

describe("pi harness quarantine", () => {
  it("only apps/web/container/src/pi imports @earendil-works/pi-*", () => {
    const files: string[] = [];
    sourceFiles(CONTAINER_SRC, files);
    // A floor: a moved or renamed container source tree must fail loudly rather
    // than pass by walking nothing.
    expect(files.length).toBeGreaterThan(5);

    const leaked = files
      .filter((file) => !file.startsWith(`${QUARANTINE}${path.sep}`))
      .filter((file) => PI_IMPORT.test(fs.readFileSync(file, "utf8")))
      .map((file) => `  ${path.relative(REPO_ROOT, file).split(path.sep).join("/")}`);

    expect(
      leaked,
      `pi imports outside the quarantine — add a file under container/src/pi and\n` +
        `export the image's own shape from it, never import pi upward:\n${leaked.join("\n")}`,
    ).toEqual([]);
  });

  it("the quarantine still holds the imports it is quarantining", () => {
    const files: string[] = [];
    sourceFiles(QUARANTINE, files);
    const importers = files.filter((file) => PI_IMPORT.test(fs.readFileSync(file, "utf8")));
    expect(
      importers.length,
      "nothing here imports pi — the regex stopped matching",
    ).toBeGreaterThan(0);
  });
});
