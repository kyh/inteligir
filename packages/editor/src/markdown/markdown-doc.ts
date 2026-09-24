// Idempotent pipeline: once roundTrip(raw) === raw, re-serializing is stable, so a rich save is
// a minimal diff. Unmodelled constructs become opaque nodes rather than a refusal.
// Plate's deserializeMd is banned: its htmlToJsx pre-pass corrupts code fences and it swallows
// parse errors into degraded models.

import { ElementApi, createSlateEditor } from "platejs";
import type { SlateEditor, Value } from "platejs";
import { serializeMd } from "@platejs/markdown";

import { MD_STRINGIFY } from "@repo/notes/markdown/md-plugins";

import { BASE_KIT } from "@repo/editor/kits/base-kit";
import { pruneForMarkdown } from "@repo/editor/markdown/md-rules";
import { mdToSlate } from "@repo/editor/markdown/md-to-slate";
import type { ConvertFailure } from "@repo/editor/markdown/md-to-slate";

export { MD_STRINGIFY } from "@repo/notes/markdown/md-plugins";

// Why a file opens Raw. Only a parse error is the file's; the rest are the editor's limits or its
// bugs, and the file keeps its bytes either way.
export type GateReason =
  | ConvertFailure
  // re-serializing never settles on one set of bytes
  | { kind: "unstable" }
  // the file parses, but re-serializing drops content or joins its lines
  | { kind: "roundtrip-loss" }
  // the pipeline threw, or answered a document the editor cannot hold
  | { kind: "pipeline-error" };

// `normalizes`: rich-safe, but the first save restyles markup.
export type DocAnalysis = { kind: "canonical" } | { kind: "normalizes" } | GateReason;

export const gateReasonFor = (analysis: DocAnalysis): GateReason | null => {
  switch (analysis.kind) {
    case "canonical":
    case "normalizes": {
      return null;
    }
    default: {
      return analysis;
    }
  }
};

export const describeGateReason = (reason: GateReason): string => {
  switch (reason.kind) {
    case "parse-error": {
      return reason.line === null
        ? `Parse error: ${reason.message}`
        : `Parse error at line ${reason.line}: ${reason.message}`;
    }
    case "too-deep": {
      return "This note nests deeper than the rich editor can hold — opened in Raw";
    }
    case "unstable": {
      return "Rich editing cannot settle this file's formatting — opened in Raw to protect it";
    }
    case "roundtrip-loss": {
      return "Rich editing would change this file's content — opened in Raw to protect it";
    }
    case "pipeline-error": {
      return "The rich editor failed on this file — opened in Raw to protect it";
    }
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
};

export class RoundTripError extends Error {
  readonly reason: GateReason;

  constructor(reason: GateReason) {
    super(describeGateReason(reason));
    this.name = "RoundTripError";
    this.reason = reason;
  }
}

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
  | { ok: true; value: Value; editor: SlateEditor }
  | { ok: false; reason: GateReason };

const convert = (md: string): Converted => {
  const editor = makeEditor();
  const converted = mdToSlate(editor, md);
  if (!converted.ok) {
    return converted;
  }
  // mdast root children are flow content, so every rule yields a block; a text at the root would be
  // a rule bug that Slate's normalizer drops, so the note opens raw rather than losing it
  if (!ElementApi.isElementList(converted.nodes)) {
    return { ok: false, reason: { kind: "pipeline-error" } };
  }
  return { editor, ok: true, value: converted.nodes };
};

type Serialized = { ok: true; out: string } | { ok: false; reason: GateReason };

// The one way a value becomes bytes, the live save's and an extract's as well as the gate's: the
// rules expect the pre-pass to have run, and Plate's own serializeMd skips it.
export const serializeNote = (editor: SlateEditor, value: Value = editor.children): string =>
  serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY, value: pruneForMarkdown(value) });

// stringify overflows the stack at the same depth the conversion does
const serialize = (editor: SlateEditor, value: Value): Serialized => {
  try {
    return { ok: true, out: serializeNote(editor, value) };
  } catch (error) {
    if (error instanceof RangeError) {
      return { ok: false, reason: { kind: "too-deep" } };
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
type Fixpoint = { stable: true; at: string } | { stable: false; reason: GateReason };

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
  return { reason: { kind: "unstable" }, stable: false };
};

export const analyzeMarkdown = (md: string): DocAnalysis => {
  if (md.trim() === "") {
    return { kind: "canonical" };
  }
  const serialized = roundTripResult(md);
  if (!serialized.ok) {
    return serialized.reason;
  }
  const { out } = serialized;
  if (out === md) {
    return { kind: "canonical" };
  }
  const fixpoint = findFixpoint(out);
  if (!fixpoint.stable) {
    return fixpoint.reason;
  }
  if (out.trimEnd() === md.trimEnd() && fixpoint.at === out) {
    return { kind: "canonical" };
  }
  // rich saves pass-1 bytes and each later save advances the chain, so the whole chain must keep the text.
  return keepsText(md, out) && keepsText(md, fixpoint.at)
    ? { kind: "normalizes" }
    : { kind: "roundtrip-loss" };
};

export const parseMarkdown = (
  md: string,
): { ok: true; value: Value } | { ok: false; reason: GateReason } => {
  const converted = convert(md);
  if (!converted.ok) {
    return converted;
  }
  return { ok: true, value: converted.value };
};

export const roundTrip = (md: string): string => {
  const serialized = roundTripResult(md);
  if (!serialized.ok) {
    throw new RoundTripError(serialized.reason);
  }
  const fixpoint = findFixpoint(serialized.out);
  if (!fixpoint.stable) {
    throw new RoundTripError(fixpoint.reason);
  }
  return fixpoint.at;
};

export const toCanonical = (md: string): string => `${roundTrip(md).trimEnd()}\n`;
