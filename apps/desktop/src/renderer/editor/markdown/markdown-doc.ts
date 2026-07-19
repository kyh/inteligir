// Byte-stability brain for the vault editor — the public gate API. The only
// markdown/ file the rest of the app imports.
//
// The pipeline is normalizing but IDEMPOTENT: once a document is in canonical
// form (roundTrip(raw) === raw), re-serializing it is stable, so editing one
// block in Rich mode and saving the whole document produces a MINIMAL diff.
// Non-canonical files edit as Raw (byte-exact) until the user Formats them.
// Files that fail to parse, or that contain constructs outside the fixed
// vocabulary (vocabulary.ts), are Raw with a reason — never silently mangled.
//
// The parse is OWNED (parse.ts): Plate's deserializeMd is banned in app code —
// its htmlToJsx pre-pass corrupts code fences and it swallows parse errors
// into degraded models.

import { type Descendant, type Value, createSlateEditor } from "platejs";
import { getMergedOptionsDeserialize, mdastToSlate, serializeMd } from "@platejs/markdown";

import { MD_STRINGIFY } from "@repo/domain/markdown/md-plugins";
import { parseMdast } from "@repo/domain/markdown/parse";
import { type RawReason, scanVocabulary } from "@repo/domain/markdown/vocabulary";

import { BASE_KIT } from "@renderer/editor/kits/base-kit";

export type { RawReason };
export { MD_STRINGIFY };

export type DocAnalysis = {
  /** Rich mode is lossless: parse ok && scan ok && (canonical || letters-equal). */
  richSafe: boolean;
  /** Byte-canonical: parse ok && scan ok && round-trip byte-equal (trailing-\n-insensitive). */
  canonical: boolean;
  /** Why the file is Raw-only, for the mode badge; null when rich-capable. */
  rawReason: RawReason | null;
};

export class ParseFailedError extends Error {
  readonly reason: RawReason;

  constructor(reason: RawReason) {
    super(describeRawReason(reason));
    this.name = "ParseFailedError";
    this.reason = reason;
  }
}

/** Human-readable form of a RawReason (mode badge tooltip). */
export function describeRawReason(reason: RawReason): string {
  switch (reason.kind) {
    case "parse-error":
      return reason.line === null
        ? `Parse error: ${reason.message}`
        : `Parse error at line ${reason.line}: ${reason.message}`;
    case "unknown-jsx":
      return `Contains unsupported element <${reason.name}>`;
    case "jsx-attr":
      return `<${reason.name}> has an unsupported attribute (${reason.attr})`;
    case "expression":
      return "Contains a {…} expression";
    case "esm":
      return "Contains an import/export statement";
  }
}

/** Why the open gate refuses Rich: a pipeline RawReason, or `roundtrip-loss` —
 * the file parses within the vocabulary but re-serializing it would silently
 * drop content (a serializer bug, never user error). Desktop-gate-only: core's
 * RawReason can't produce it because only this pipeline serializes. */
export type GateReason = RawReason | { kind: "roundtrip-loss" };

/** Map a DocAnalysis to the open gate's verdict: the analysis's own reason
 * when it has one, `roundtrip-loss` when the round-trip loses content with no
 * RawReason (analyzeMarkdown's letters-diverge verdict), null when Rich is
 * safe. */
export function gateReasonFor(analysis: DocAnalysis): GateReason | null {
  if (analysis.rawReason !== null) return analysis.rawReason;
  if (analysis.richSafe) return null;
  return { kind: "roundtrip-loss" };
}

/** Human-readable form of a GateReason (mode badge tooltip). */
export function describeGateReason(reason: GateReason): string {
  if (reason.kind === "roundtrip-loss") {
    return "Rich editing would change this file's content — opened in Raw to protect it";
  }
  return describeRawReason(reason);
}

// Fresh editor per call — Slate editors carry mutable state, and these helpers
// run once per file open / content change, so construction cost is irrelevant
// and a clean editor avoids cross-call bleed.
function makeEditor() {
  return createSlateEditor({ plugins: BASE_KIT });
}

// The alphanumeric content of a string — markers, punctuation and whitespace
// dropped — used to tell formatting-only changes from real content loss.
function letters(s: string): string {
  return s.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
}

type Converted =
  | { ok: true; value: Descendant[]; editor: ReturnType<typeof makeEditor> }
  | { ok: false; reason: RawReason };

// The mdast→Slate→stringify recursion overflows the stack around nesting
// depth ~1250 (micromark's own parse survives to ~6-8k, where parseMdast
// catches its overflow). A RangeError in this band is a depth failure, not a
// pipeline bug — classify it Raw. Anything else is a real bug: rethrow.
const DEPTH_REASON: RawReason = {
  kind: "parse-error",
  line: null,
  message: "Document nests too deeply to convert",
};

function rangeErrorToRaw(error: unknown): RawReason {
  if (error instanceof RangeError) return DEPTH_REASON;
  throw error;
}

// One parse + scan + mdast→Slate pass, shared by every entry point.
function convert(md: string): Converted {
  const parsed = parseMdast(md);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: { kind: "parse-error", line: parsed.failure.line, message: parsed.failure.message },
    };
  }
  const rejected = scanVocabulary(parsed.root);
  if (rejected) return { ok: false, reason: rejected };
  const editor = makeEditor();
  try {
    const value = mdastToSlate(parsed.root, getMergedOptionsDeserialize(editor));
    return { editor, ok: true, value };
  } catch (error) {
    return { ok: false, reason: rangeErrorToRaw(error) };
  }
}

type Serialized = { ok: true; out: string } | { ok: false; reason: RawReason };

function serialize(editor: ReturnType<typeof makeEditor>, value: Descendant[]): Serialized {
  try {
    return { ok: true, out: serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY, value }) };
  } catch (error) {
    return { ok: false, reason: rangeErrorToRaw(error) };
  }
}

// One full parse→serialize pass as a Result (the throwing `roundTrip` wraps it).
function roundTripResult(md: string): Serialized {
  const converted = convert(md);
  if (!converted.ok) return converted;
  return serialize(converted.editor, converted.value);
}

// Defense in depth for the classifier: the canonical/rich gate must never
// bless a form that drifts or breaks on the NEXT save. `out` is trusted only
// if re-serializing it reproduces it byte-exactly (one extra pass; a third
// probe distinguishes "stabilizes at pass 2" from "never settles"). Every
// known input is a pass-1 fixpoint — this catches future regressions, turning
// would-be corruption into an honest Raw/non-rich classification.
const UNSTABLE_REASON: RawReason = {
  kind: "parse-error",
  line: null,
  message: "Round-trip does not stabilize",
};

type Fixpoint =
  | { stable: true; at: string } // `at` re-serializes to itself
  | { stable: false; reason: RawReason };

function findFixpoint(out: string): Fixpoint {
  let current = out;
  // ≤3 total passes over the document: out was pass 1; probe passes 2 and 3.
  for (let pass = 0; pass < 2; pass++) {
    const next = roundTripResult(current);
    if (!next.ok) return { reason: next.reason, stable: false };
    if (next.out === current) return { at: current, stable: true };
    current = next.out;
  }
  return { reason: UNSTABLE_REASON, stable: false };
}

/** Classify `md`: one parse+serialize pass, plus a fixpoint probe of the
 * output when it isn't already byte-identical (call once per content change). */
export function analyzeMarkdown(md: string): DocAnalysis {
  if (md.trim() === "") return { canonical: true, rawReason: null, richSafe: true };
  const converted = convert(md);
  if (!converted.ok) return { canonical: false, rawReason: converted.reason, richSafe: false };
  const serialized = serialize(converted.editor, converted.value);
  if (!serialized.ok) return { canonical: false, rawReason: serialized.reason, richSafe: false };
  const out = serialized.out;
  // Byte-identical output is trivially a fixpoint — the common canonical case
  // (files we saved end in exactly one "\n") stays a single pass.
  if (out !== md) {
    const fixpoint = findFixpoint(out);
    if (!fixpoint.stable) {
      return { canonical: false, rawReason: fixpoint.reason, richSafe: false };
    }
    // Rich mode saves pass-1 bytes and each later save advances the chain, so
    // rich is only safe when the whole chain preserves the letters of `md`.
    const canonical = out.trimEnd() === md.trimEnd() && fixpoint.at === out;
    const richSafe =
      canonical || (letters(md) === letters(out) && letters(md) === letters(fixpoint.at));
    return { canonical, rawReason: null, richSafe };
  }
  return { canonical: true, rawReason: null, richSafe: true };
}

/** Parse `md` to a Plate value — the live editor's seed path. */
export function parseMarkdown(
  md: string,
): { ok: true; value: Value } | { ok: false; reason: RawReason } {
  const converted = convert(md);
  if (!converted.ok) return { ok: false, reason: converted.reason };
  // mdast root children are flow nodes, so the converted value is TElement[]
  // in practice; Plate's own deserializeMd performs this exact widening.
  // oxlint-disable-next-line typescript/consistent-type-assertions
  return { ok: true, value: converted.value as Value };
}

/** Serialize the parse of `md` — the pipeline's canonical form of the
 * document, verified stable (re-serializing the result is a no-op; see
 * findFixpoint). Throws ParseFailedError when the file can't round-trip
 * (parse/scan failure) or its serialized form never settles. */
export function roundTrip(md: string): string {
  const serialized = roundTripResult(md);
  if (!serialized.ok) throw new ParseFailedError(serialized.reason);
  const fixpoint = findFixpoint(serialized.out);
  if (!fixpoint.stable) throw new ParseFailedError(fixpoint.reason);
  return fixpoint.at;
}

/** Canonicalize `md` (the one-time Format action). Idempotent thereafter.
 * Throws ParseFailedError when there is nothing safe to format to. */
export function toCanonical(md: string): string {
  return roundTrip(md).trimEnd() + "\n";
}
