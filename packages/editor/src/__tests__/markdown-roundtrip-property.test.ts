import { describe, expect, it } from "vitest";

import { roundTrip, toCanonical } from "@repo/editor/markdown/markdown-doc";
import { generateDoc } from "./markdown-doc-generator";

// Seeded property-based round-trip fuzzing over the vocabulary-composed
// generator (markdown-doc-generator.ts) — complements the byte-pinned fixture
// matrix (markdown-fixpoint.test.ts) and the adversarial byte/fragment fuzzer
// (markdown-adversarial.test.ts) with structurally well-formed documents
// built from the SAME node vocabulary the fixtures hand-pin. Rationale
// (hubble's MarkdownRoundtrip pattern): byte-pinned fixtures are strong for
// KNOWN shapes and blind to unknown ones — a seeded fuzzer turns "we
// round-trip everything we thought of" into "a fuzzer agrees", with every
// counterexample replayable by seed.
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
// `ROUNDTRIP_SEED=<n> pnpm --filter @repo/editor test markdown-roundtrip-property`.
//
// N: each seed pays a full parse+serialize (createSlateEditor is not cheap),
// so 200 seeds run ~25s against a ~10s suite-time budget. Coverage lives in
// the generator's ~5-40 block range, not in seed count — so N is the knob to
// turn, never the doc-size range; 72 keeps this file at ~7s with margin.
const BASE_SEED = 20260708; // arbitrary, but fixed: changing it reshuffles every doc
const N = 72;

function seeds(): number[] {
  const override = process.env.ROUNDTRIP_SEED;
  if (override !== undefined && override !== "") return [Number(override)];
  return Array.from({ length: N }, (_, i) => BASE_SEED + i);
}

// Seeds where the fuzzer found a genuine round-trip bug that isn't a
// one-liner fix. Pin the seed here (skipped) rather than fixing blind, and
// document the failure's shape in a comment beside the seed — each pin is a
// finding, replayable via ROUNDTRIP_SEED. Currently empty: no known bugs.
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
    it.skip(`seed ${seed} (pinned — see the comment beside it in KNOWN_FAILURES)`, () => {
      expect(checkSeed(seed)).toBeNull();
    });
  }
});
