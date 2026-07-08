import { describe, expect, it } from "vitest";

import { roundTrip, toCanonical } from "@renderer/editor/markdown/markdown-doc";
import { generateDoc } from "./markdown-doc-generator";

// Seeded property-based round-trip fuzzing over the vocabulary-composed
// generator (markdown-doc-generator.ts) — complements the byte-pinned fixture
// matrix (markdown-fixpoint.test.ts) and the adversarial byte/fragment fuzzer
// (markdown-adversarial.test.ts) with structurally well-formed documents
// built from the SAME node vocabulary the fixtures hand-pin. See plan 018.
//
// Invariant per generated doc `d`:
//   1. toCanonical(d) reaches a fixpoint (does not throw) — the pipeline
//      accepts every vocabulary-legal shape the generator can produce.
//   2. serialize(parse(canonical)) === canonical — the canonical form is
//      itself byte-stable (mirrors the canonical fixture class, generated
//      instead of hand-written).
//
// All seeds run inside ONE test (like markdown-adversarial's report/hunt
// loop) so per-seed vitest bookkeeping doesn't dominate the ~10s budget — only
// the parse/serialize work does. On failure the message includes every
// failing seed + a truncated doc excerpt, so it's replayable in isolation:
// `ROUNDTRIP_SEED=<n> pnpm --filter @repo/desktop test markdown-roundtrip-property`.
//
// N: plan 018 targets 200 seeds, but each seed pays a full parse+serialize
// (createSlateEditor is not cheap) — 200 measured at ~25s, over the ~10s
// suite-time budget. Per the plan's own tuning order ("tune N down before
// tuning doc size down"), N is cut instead of shrinking the ~5-40 block
// generator range; 72 keeps this file at ~7s with margin.
const BASE_SEED = 20260708; // plan-018 authoring date — arbitrary but fixed
const N = 72;

function seeds(): number[] {
  const override = process.env.ROUNDTRIP_SEED;
  if (override !== undefined && override !== "") return [Number(override)];
  return Array.from({ length: N }, (_, i) => BASE_SEED + i);
}

// Seeds where the fuzzer found a genuine round-trip bug that isn't a
// one-liner fix. Pinned here (skipped) rather than fixed — see NOTES in the
// plan-018 executor report for the shape of each.
const KNOWN_FAILURES = new Set<number>([]);

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
    { timeout: 30_000 },
    () => {
      const failures: string[] = [];
      for (const seed of seeds()) {
        if (KNOWN_FAILURES.has(seed)) continue;
        const failure = checkSeed(seed);
        if (failure) failures.push(failure);
      }
      expect(failures).toEqual([]);
    },
  );

  for (const seed of KNOWN_FAILURES) {
    it.skip(`seed ${seed} (pinned — see plan-018 NOTES)`, () => {
      expect(checkSeed(seed)).toBeNull();
    });
  }
});
