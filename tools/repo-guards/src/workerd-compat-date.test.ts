// workerd's version is a date (1.YYYYMMDD.N). the pin is the oldest resolved workerd, never the
// newest: a workerd cannot emulate a date it predates.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./repo";

const LOCKFILE = "pnpm-lock.yaml";
const COMPATIBILITY = "apps/web/compatibility.ts";

// the package and its per-platform binaries; peer ranges carry no `@` and stay unmatched.
const RESOLVED_WORKERD = /\bworkerd(?:-[a-z0-9-]+)?@1\.(?<stamp>\d{8})\./gu;

const resolvedWorkerdDates = (): string[] => {
  const source = fs.readFileSync(path.join(REPO_ROOT, LOCKFILE), "utf-8");
  const dates = new Set<string>();
  for (const match of source.matchAll(RESOLVED_WORKERD)) {
    const stamp = match.groups?.stamp;
    if (stamp !== undefined) {
      dates.add(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`);
    }
  }
  return [...dates].toSorted();
};

const declaredCompatibilityDate = (): string => {
  const source = fs.readFileSync(path.join(REPO_ROOT, COMPATIBILITY), "utf-8");
  const date = /compatibilityDate = "(?<date>\d{4}-\d{2}-\d{2})"/u.exec(source)?.groups?.date;
  if (date === undefined) {
    throw new Error(`${COMPATIBILITY}: no compatibilityDate to hold against ${LOCKFILE}`);
  }
  return date;
};

describe("workerd compatibilityDate", () => {
  it("is the date of the oldest workerd the lockfile resolves", () => {
    const dates = resolvedWorkerdDates();
    const [oldest] = dates;
    if (oldest === undefined) {
      throw new Error(`${LOCKFILE} resolves no workerd — the sweep is broken, not the tree`);
    }
    expect(
      declaredCompatibilityDate(),
      `${COMPATIBILITY}: compatibilityDate is not the OLDEST workerd date the lockfile resolves (resolved: ${dates.join(", ")}).\n` +
        `  rule: the runtime's version is its date — a config date behind the resolved runtime silently opts out of its fixes, and one ahead of the oldest is one that workerd cannot emulate\n` +
        `  fix: set compatibilityDate to ${oldest} in ${COMPATIBILITY}`,
    ).toBe(oldest);
  });
});
