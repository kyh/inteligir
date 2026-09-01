// ---------------------------------------------------------------------------
// wrangler.jsonc's `compatibility_date` against the workerd the lockfile
// actually resolves.
//
// workerd's version IS a date (1.YYYYMMDD.N), and the date the config declares
// decides which runtime behaviors the deployed Worker gets. The two drift in
// one direction only — a dependency bump pulls a newer workerd and nothing
// touches the config — and the symptom is silence: every gate stays green
// while the Worker opts out of weeks of runtime fixes the local runtime
// already carries. A date AHEAD of a resolved workerd is the louder failure
// (a workerd cannot emulate a date it predates), which is why the pin is the
// OLDEST resolved workerd, never the newest.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./repo";

const LOCKFILE = "pnpm-lock.yaml";
const WRANGLER_CONFIG = "apps/web/wrangler.jsonc";

/** workerd as pnpm resolves it — the package itself and its per-platform
 *  binaries: `workerd@1.<yyyymmdd>.<n>` / `workerd-darwin-64@1.<yyyymmdd>.<n>`.
 *  Peer RANGES (`workerd: '>1.….0 <2.0.0-0'`) carry no `@` and stay unmatched. */
const RESOLVED_WORKERD = /\bworkerd(?:-[a-z0-9-]+)?@1\.(\d{8})\./g;

function resolvedWorkerdDates(): string[] {
  const source = fs.readFileSync(path.join(REPO_ROOT, LOCKFILE), "utf8");
  const dates = new Set<string>();
  for (const match of source.matchAll(RESOLVED_WORKERD)) {
    const stamp = match[1];
    if (stamp !== undefined) {
      dates.add(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`);
    }
  }
  return [...dates].toSorted();
}

function declaredCompatibilityDate(): string {
  const source = fs.readFileSync(path.join(REPO_ROOT, WRANGLER_CONFIG), "utf8");
  const date = /"compatibility_date":\s*"(\d{4}-\d{2}-\d{2})"/.exec(source)?.[1];
  if (date === undefined) {
    throw new Error(`${WRANGLER_CONFIG}: no "compatibility_date" to hold against ${LOCKFILE}`);
  }
  return date;
}

describe("wrangler compatibility_date", () => {
  it("is the date of the oldest workerd the lockfile resolves", () => {
    const dates = resolvedWorkerdDates();
    const [oldest] = dates;
    if (oldest === undefined) {
      throw new Error(`${LOCKFILE} resolves no workerd — the sweep is broken, not the tree`);
    }
    expect(
      declaredCompatibilityDate(),
      `${WRANGLER_CONFIG}: compatibility_date is not the OLDEST workerd date the lockfile resolves (resolved: ${dates.join(", ")}).\n` +
        `  rule: the runtime's version is its date — a config date behind the resolved runtime silently opts out of its fixes, and one ahead of the oldest is one that workerd cannot emulate\n` +
        `  fix: set compatibility_date to ${oldest} in ${WRANGLER_CONFIG}`,
    ).toBe(oldest);
  });
});
