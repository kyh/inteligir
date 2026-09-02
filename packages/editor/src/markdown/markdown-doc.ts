// Idempotent pipeline: once roundTrip(raw) === raw, re-serializing is stable, so a rich save is
// a minimal diff. Only a parse failure is refused — unmodelled constructs become opaque nodes.
// Plate's deserializeMd is banned: its htmlToJsx pre-pass corrupts code fences and it swallows
// parse errors into degraded models.

import { type Descendant, type Value, createSlateEditor } from "platejs";
import { getMergedOptionsDeserialize, mdastToSlate, serializeMd } from "@platejs/markdown";

import { MD_STRINGIFY } from "@repo/notes/markdown/md-plugins";
import { parseMdast } from "@repo/notes/markdown/parse";

import { BASE_KIT } from "@repo/editor/kits/base-kit";

export { MD_STRINGIFY };

export type RawReason = { kind: "parse-error"; message: string; line: number | null };

export type DocAnalysis = {
  richSafe: boolean;
  canonical: boolean;
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

export function describeRawReason(reason: RawReason): string {
  return reason.line === null
    ? `Parse error: ${reason.message}`
    : `Parse error at line ${reason.line}: ${reason.message}`;
}

// roundtrip-loss: the file parses but re-serializing drops content (a serializer bug, never user error).
export type GateReason = RawReason | { kind: "roundtrip-loss" };

export function gateReasonFor(analysis: DocAnalysis): GateReason | null {
  if (analysis.rawReason !== null) return analysis.rawReason;
  if (analysis.richSafe) return null;
  return { kind: "roundtrip-loss" };
}

export function describeGateReason(reason: GateReason): string {
  if (reason.kind === "roundtrip-loss") {
    return "Rich editing would change this file's content — opened in Raw to protect it";
  }
  return describeRawReason(reason);
}

// fresh per call: Slate editors carry mutable state.
function makeEditor() {
  return createSlateEditor({ plugins: BASE_KIT });
}

function letters(s: string): string {
  return s.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
}

type Converted =
  | { ok: true; value: Descendant[]; editor: ReturnType<typeof makeEditor> }
  | { ok: false; reason: RawReason };

// mdast→Slate→stringify overflows the stack around nesting depth ~1250 (micromark survives to
// ~6-8k); a RangeError is a depth failure, anything else is a real bug and rethrows.
const DEPTH_REASON: RawReason = {
  kind: "parse-error",
  line: null,
  message: "Document nests too deeply to convert",
};

function convert(md: string): Converted {
  const parsed = parseMdast(md);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: { kind: "parse-error", line: parsed.failure.line, message: parsed.failure.message },
    };
  }
  const editor = makeEditor();
  try {
    const value = mdastToSlate(parsed.root, getMergedOptionsDeserialize(editor));
    return { editor, ok: true, value };
  } catch (error) {
    if (error instanceof RangeError) return { ok: false, reason: DEPTH_REASON };
    throw error;
  }
}

type Serialized = { ok: true; out: string } | { ok: false; reason: RawReason };

function serialize(editor: ReturnType<typeof makeEditor>, value: Descendant[]): Serialized {
  try {
    return { ok: true, out: serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY, value }) };
  } catch (error) {
    if (error instanceof RangeError) return { ok: false, reason: DEPTH_REASON };
    throw error;
  }
}

function roundTripResult(md: string): Serialized {
  const converted = convert(md);
  if (!converted.ok) return converted;
  return serialize(converted.editor, converted.value);
}

// `out` is trusted only if re-serializing reproduces it byte-exactly; a third probe
// distinguishes "stabilizes at pass 2" from "never settles".
const UNSTABLE_REASON: RawReason = {
  kind: "parse-error",
  line: null,
  message: "Round-trip does not stabilize",
};

type Fixpoint = { stable: true; at: string } | { stable: false; reason: RawReason };

function findFixpoint(out: string): Fixpoint {
  let current = out;
  for (let pass = 0; pass < 2; pass++) {
    const next = roundTripResult(current);
    if (!next.ok) return { reason: next.reason, stable: false };
    if (next.out === current) return { at: current, stable: true };
    current = next.out;
  }
  return { reason: UNSTABLE_REASON, stable: false };
}

export function analyzeMarkdown(md: string): DocAnalysis {
  if (md.trim() === "") return { canonical: true, rawReason: null, richSafe: true };
  const converted = convert(md);
  if (!converted.ok) return { canonical: false, rawReason: converted.reason, richSafe: false };
  const serialized = serialize(converted.editor, converted.value);
  if (!serialized.ok) return { canonical: false, rawReason: serialized.reason, richSafe: false };
  const out = serialized.out;
  if (out !== md) {
    const fixpoint = findFixpoint(out);
    if (!fixpoint.stable) {
      return { canonical: false, rawReason: fixpoint.reason, richSafe: false };
    }
    // rich saves pass-1 bytes and each later save advances the chain, so the whole chain must keep the letters.
    const canonical = out.trimEnd() === md.trimEnd() && fixpoint.at === out;
    const source = letters(md);
    const richSafe = canonical || (source === letters(out) && source === letters(fixpoint.at));
    return { canonical, rawReason: null, richSafe };
  }
  return { canonical: true, rawReason: null, richSafe: true };
}

export function parseMarkdown(
  md: string,
): { ok: true; value: Value } | { ok: false; reason: RawReason } {
  const converted = convert(md);
  if (!converted.ok) return { ok: false, reason: converted.reason };
  // SAFETY: mdast root children are flow nodes, so every converted descendant
  // is an element; Plate's own deserializeMd performs this exact widening.
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- mdast root children are flow nodes, see the SAFETY note above
  return { ok: true, value: converted.value as Value };
}

export function roundTrip(md: string): string {
  const serialized = roundTripResult(md);
  if (!serialized.ok) throw new ParseFailedError(serialized.reason);
  const fixpoint = findFixpoint(serialized.out);
  if (!fixpoint.stable) throw new ParseFailedError(fixpoint.reason);
  return fixpoint.at;
}

export function toCanonical(md: string): string {
  return roundTrip(md).trimEnd() + "\n";
}
