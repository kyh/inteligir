import { describe, expect, it } from "vitest";

import { roundTrip, toCanonical } from "@repo/editor/markdown/markdown-doc";
import { generateDoc } from "./markdown-doc-generator";

// All seeds run inside one test so per-seed vitest bookkeeping does not dominate
// the budget. Replay one with
// `ROUNDTRIP_SEED=<n> pnpm --filter @repo/editor test markdown-roundtrip-property`.
// Each seed pays a full parse+serialize (~150ms), so N is the knob, never the doc-size range.
const BASE_SEED = 20260708; // changing it reshuffles every doc
const N = 72;

function seeds(): number[] {
  const override = process.env.ROUNDTRIP_SEED;
  if (override !== undefined && override !== "") return [Number(override)];
  return Array.from({ length: N }, (_, i) => BASE_SEED + i);
}

function checkSeed(seed: number): string | null {
  const doc = generateDoc(seed);
  let canonical: string;
  try {
    canonical = toCanonical(doc);
  } catch (error) {
    return (
      `seed=${seed} toCanonical did not reach a fixpoint: ${String(error)}\n` +
      `doc (${doc.length}b, truncated to 2000):\n${doc.slice(0, 2000)}`
    );
  }
  let out: string;
  try {
    out = roundTrip(canonical);
  } catch (error) {
    return (
      `seed=${seed} canonical form failed to re-parse: ${String(error)}\n` +
      `canonical (${canonical.length}b, truncated to 2000):\n${canonical.slice(0, 2000)}`
    );
  }
  if (out !== canonical) {
    return (
      `seed=${seed} canonical form is not byte-stable\n` +
      `canonical (${canonical.length}b, truncated to 2000):\n${canonical.slice(0, 2000)}`
    );
  }
  return null;
}

describe("seeded property-based round-trip fuzzing", () => {
  it(
    `${N} generated documents reach a canonical fixpoint and re-serialize byte-stable`,
    { timeout: 90_000 },
    () => {
      const failures: string[] = [];
      for (const seed of seeds()) {
        const failure = checkSeed(seed);
        if (failure) failures.push(failure);
      }
      expect(failures).toEqual([]);
    },
  );
});
