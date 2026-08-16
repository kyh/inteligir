// ---------------------------------------------------------------------------
// Every module-scope store is accounted for when a session ends.
//
// `endWorkspaceSession` (packages/workspace/src/workspace/workspace-runtime.ts)
// is the one place a session ends, and its header asks that a store growing
// account-scoped state add a `reset()` and a line there. That request was
// PROSE, and prose is exactly what failed: `useOpenNote` — the store holding
// the open note's BYTES — was left out, so the next account signing in to the
// same document rendered the previous one's buffer, filename and privacy badge.
//
// So the list is derived instead. A new `create()` anywhere under
// packages/{workspace,editor} fails this test until it is either torn down or
// named below with a reason. The point is not that every store must reset — it
// is that leaving one out has to be a DECISION somebody wrote down.
//
// The check keys on the store's MODULE rather than its name, because a store is
// torn down through whatever its module exports for the purpose
// (`resetOpenNote`, `stopReadAloud`, `consumeSearchRequest`) and matching the
// store's own identifier would miss every one of those. Two details are
// load-bearing, and both were wrong first time round:
//
//   * the module is matched as a PATH SEGMENT. A bare `includes` lets
//     "ai-review-store" satisfy "view-store", which silently exempted an entire
//     store.
//   * a mention in the IMPORTS is not evidence. A reset dropped in a refactor
//     leaves its import behind, and a whole-file match reads that leftover as
//     proof the store is handled — precisely the failure this guard exists to
//     catch. So the imports say WHICH names come from a store's module, and the
//     function body has to actually use one of them.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const RUNTIME = path.join(REPO_ROOT, "packages/workspace/src/workspace/workspace-runtime.ts");
const STORE_ROOTS = ["packages/workspace/src", "packages/editor/src"];

/** `export const useThing = create<…>()` — the module-scope store shape. */
const STORE_DECL = /export const (use[A-Za-z0-9_]+)\s*=\s*create</g;

/**
 * Stores a session end deliberately does NOT reset, each with the reason.
 * Anything here is a claim a reader can check, which is the whole difference
 * between an exemption and an oversight.
 */
const NOT_ACCOUNT_SCOPED: Record<string, string> = {};

function sourceFiles(dir: string, out: string[]): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "__tests__") sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) {
      out.push(full);
    }
  }
  return out;
}

/** Each store, with the module basename it is declared in. */
function declaredStores(): { name: string; module: string }[] {
  const found = new Map<string, string>();
  for (const dir of STORE_ROOTS) {
    for (const file of sourceFiles(path.join(REPO_ROOT, dir), [])) {
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(STORE_DECL)) {
        const name = match[1];
        if (name !== undefined) found.set(name, path.basename(file).replace(/\.tsx?$/, ""));
      }
    }
  }
  return [...found]
    .map(([name, module]) => ({ name, module }))
    .toSorted((a, b) => (a.name < b.name ? -1 : 1));
}

/**
 * `endWorkspaceSession`'s body alone — imports and every other export excluded,
 * so a leftover import cannot stand in for a call that was removed.
 */
function teardownBody(source: string): string {
  const start = source.indexOf("export async function endWorkspaceSession");
  if (start === -1) throw new Error("session-teardown: endWorkspaceSession not found");
  const end = source.indexOf("\n}", start);
  if (end === -1)
    throw new Error("session-teardown: could not find the end of endWorkspaceSession");
  return source.slice(start, end);
}

/** Every name the runtime imports, grouped by the module it came from. The
 * module is keyed by its BASENAME as a path segment, so one module's name
 * cannot be a substring of another's and quietly exempt it. */
function importsByModule(source: string): Map<string, string[]> {
  const byModule = new Map<string, string[]>();
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) {
    const names = (match[1] ?? "").split(",").map((name) => name.replace(/^type\s+/, "").trim());
    const module = (match[2] ?? "").split("/").pop() ?? "";
    byModule.set(module, [...(byModule.get(module) ?? []), ...names.filter(Boolean)]);
  }
  return byModule;
}

describe("ending a session accounts for every store", () => {
  it("sweeps both packages", () => {
    // A floor: a moved tree or a changed declaration shape would otherwise make
    // every assertion below trivially satisfied.
    expect(
      declaredStores().length,
      "the sweep found almost no stores — did the tree move?",
    ).toBeGreaterThan(8);
  });

  it("tears down, or explicitly exempts, every module-scope store", () => {
    const source = fs.readFileSync(RUNTIME, "utf8");
    const body = teardownBody(source);
    const imported = importsByModule(source);
    const unaccounted = declaredStores()
      .filter(({ name, module }) => {
        if (name in NOT_ACCOUNT_SCOPED) return false;
        // Something from this store's module has to be USED in the teardown —
        // the store itself, or whatever its module exports for the purpose.
        const names = imported.get(module) ?? [];
        return !names.some((exported) => new RegExp(`\\b${exported}\\b`).test(body));
      })
      .map(({ name }) => name);

    expect(
      unaccounted,
      `these stores survive a sign-out and nothing says why:\n  ${unaccounted.join("\n  ")}\n` +
        "Either reset them in endWorkspaceSession, or name them in NOT_ACCOUNT_SCOPED " +
        "with the reason they hold nothing belonging to the account.",
    ).toEqual([]);
  });
});
