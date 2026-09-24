// Idempotent pipeline: once roundTrip(raw) === raw, re-serializing is stable, so a rich save is
// a minimal diff. Only a parse failure is refused — unmodelled constructs become opaque nodes.
// Plate's deserializeMd is banned: its htmlToJsx pre-pass corrupts code fences and it swallows
// parse errors into degraded models.

import { createSlateEditor, ElementApi } from "platejs";
import type { Descendant, Value } from "platejs";
import { getMergedOptionsDeserialize, mdastToSlate, serializeMd } from "@platejs/markdown";

import { MD_STRINGIFY } from "@repo/notes/markdown/md-plugins";
import { parseMdast } from "@repo/notes/markdown/parse";

import { BASE_KIT } from "@repo/editor/kits/base-kit";

export { MD_STRINGIFY } from "@repo/notes/markdown/md-plugins";

export interface RawReason {
  kind: "parse-error";
  message: string;
  line: number | null;
}

export interface DocAnalysis {
  richSafe: boolean;
  canonical: boolean;
  rawReason: RawReason | null;
}

export const describeRawReason = (reason: RawReason): string =>
  reason.line === null
    ? `Parse error: ${reason.message}`
    : `Parse error at line ${reason.line}: ${reason.message}`;

export class ParseFailedError extends Error {
  readonly reason: RawReason;

  constructor(reason: RawReason) {
    super(describeRawReason(reason));
    this.name = "ParseFailedError";
    this.reason = reason;
  }
}

// roundtrip-loss: the file parses but re-serializing drops content or joins its lines (a serializer
// bug, never user error).
export type GateReason = RawReason | { kind: "roundtrip-loss" };

export const gateReasonFor = (analysis: DocAnalysis): GateReason | null => {
  if (analysis.rawReason !== null) {
    return analysis.rawReason;
  }
  if (analysis.richSafe) {
    return null;
  }
  return { kind: "roundtrip-loss" };
};

export const describeGateReason = (reason: GateReason): string => {
  if (reason.kind === "roundtrip-loss") {
    return "Rich editing would change this file's content — opened in Raw to protect it";
  }
  return describeRawReason(reason);
};

// fresh per call: Slate editors carry mutable state.
const makeEditor = () => createSlateEditor({ plugins: BASE_KIT });

const letters = (s: string): string => s.replaceAll(/[^\p{L}\p{N}]+/gu, "").toLowerCase();

const lineEndOffsets = (lines: readonly string[]): number[] => {
  const ends: number[] = [];
  let at = 0;
  for (const line of lines) {
    at += line.length;
    ends.push(at);
  }
  return ends;
};

// A save may restyle markup or split a line (two date chips become two paragraphs), but joining
// two lines changes what the note says without losing a letter: `[[A]]\n[[B]]` as `[[A]][[B]]`.
// So every offset where a source line's letters end must still end a saved line.
const keepsText = (source: string, saved: string): boolean => {
  const sourceLines = source.split("\n").map(letters);
  const savedLines = saved.split("\n").map(letters);
  if (sourceLines.join("") !== savedLines.join("")) {
    return false;
  }
  const savedEnds = new Set([0, ...lineEndOffsets(savedLines)]);
  return lineEndOffsets(sourceLines).every((end) => savedEnds.has(end));
};

type Converted =
  | { ok: true; value: Value; editor: ReturnType<typeof makeEditor> }
  | { ok: false; reason: RawReason };

// mdast→Slate→stringify overflows the stack around nesting depth ~1250 (micromark survives to
// ~6-8k); a RangeError is a depth failure, anything else is a real bug and rethrows.
const DEPTH_REASON: RawReason = {
  kind: "parse-error",
  line: null,
  message: "Document nests too deeply to convert",
};

// mdast root children are flow content, so every rule yields a block; a text at the root would be
// a rule bug that Slate's normalizer drops, so the note opens raw rather than losing it.
const TOP_LEVEL_TEXT_REASON: RawReason = {
  kind: "parse-error",
  line: null,
  message: "Text converted outside any block",
};

const convert = (md: string): Converted => {
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
    if (!ElementApi.isElementList(value)) {
      return { ok: false, reason: TOP_LEVEL_TEXT_REASON };
    }
    return { editor, ok: true, value };
  } catch (error) {
    if (error instanceof RangeError) {
      return { ok: false, reason: DEPTH_REASON };
    }
    throw error;
  }
};

type Serialized = { ok: true; out: string } | { ok: false; reason: RawReason };

const serialize = (editor: ReturnType<typeof makeEditor>, value: Descendant[]): Serialized => {
  try {
    return { ok: true, out: serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY, value }) };
  } catch (error) {
    if (error instanceof RangeError) {
      return { ok: false, reason: DEPTH_REASON };
    }
    throw error;
  }
};

const roundTripResult = (md: string): Serialized => {
  const converted = convert(md);
  if (!converted.ok) {
    return converted;
  }
  return serialize(converted.editor, converted.value);
};

// `out` is trusted only if re-serializing reproduces it byte-exactly; a third probe
// distinguishes "stabilizes at pass 2" from "never settles".
const UNSTABLE_REASON: RawReason = {
  kind: "parse-error",
  line: null,
  message: "Round-trip does not stabilize",
};

type Fixpoint = { stable: true; at: string } | { stable: false; reason: RawReason };

const findFixpoint = (out: string): Fixpoint => {
  let current = out;
  for (let pass = 0; pass < 2; pass += 1) {
    const next = roundTripResult(current);
    if (!next.ok) {
      return { reason: next.reason, stable: false };
    }
    if (next.out === current) {
      return { at: current, stable: true };
    }
    current = next.out;
  }
  return { reason: UNSTABLE_REASON, stable: false };
};

export const analyzeMarkdown = (md: string): DocAnalysis => {
  if (md.trim() === "") {
    return { canonical: true, rawReason: null, richSafe: true };
  }
  const converted = convert(md);
  if (!converted.ok) {
    return { canonical: false, rawReason: converted.reason, richSafe: false };
  }
  const serialized = serialize(converted.editor, converted.value);
  if (!serialized.ok) {
    return { canonical: false, rawReason: serialized.reason, richSafe: false };
  }
  const { out } = serialized;
  if (out !== md) {
    const fixpoint = findFixpoint(out);
    if (!fixpoint.stable) {
      return { canonical: false, rawReason: fixpoint.reason, richSafe: false };
    }
    // rich saves pass-1 bytes and each later save advances the chain, so the whole chain must keep the text.
    const canonical = out.trimEnd() === md.trimEnd() && fixpoint.at === out;
    const richSafe = canonical || (keepsText(md, out) && keepsText(md, fixpoint.at));
    return { canonical, rawReason: null, richSafe };
  }
  return { canonical: true, rawReason: null, richSafe: true };
};

export const parseMarkdown = (
  md: string,
): { ok: true; value: Value } | { ok: false; reason: RawReason } => {
  const converted = convert(md);
  if (!converted.ok) {
    return { ok: false, reason: converted.reason };
  }
  return { ok: true, value: converted.value };
};

export const roundTrip = (md: string): string => {
  const serialized = roundTripResult(md);
  if (!serialized.ok) {
    throw new ParseFailedError(serialized.reason);
  }
  const fixpoint = findFixpoint(serialized.out);
  if (!fixpoint.stable) {
    throw new ParseFailedError(fixpoint.reason);
  }
  return fixpoint.at;
};

export const toCanonical = (md: string): string => `${roundTrip(md).trimEnd()}\n`;
