// Idempotent pipeline: once roundTrip(raw) === raw, re-serializing is stable, so what the codec
// exports reads back as the same bytes. Unmodelled constructs become opaque nodes rather than a
// refusal.
// Plate's deserializeMd is banned (`@repo/editor/kits/markdown-kit` says why).

import { ElementApi, createSlateEditor } from "platejs";
import type { SlateEditor, Value } from "platejs";
import { serializeMd } from "@platejs/markdown";

import { recordFlowSpans } from "@repo/notes/markdown/flow-spans";
import type { FlowSpan } from "@repo/notes/markdown/flow-spans";
import { MD_STRINGIFY } from "@repo/notes/markdown/md-plugins";
import { CELL_BREAK } from "@repo/notes/markdown/remark-inline-html";

import { BASE_KIT } from "@repo/editor/kits/base-kit";
import { pruneForMarkdown } from "@repo/editor/markdown/md-rules";
import { mdToSlate, withinStack } from "@repo/editor/markdown/md-to-slate";
import type { ConvertFailure } from "@repo/editor/markdown/md-to-slate";

// Why a value cannot stand for its markdown: never the bytes, which always parse, but the
// editor's limits or its bugs.
type RoundTripFailure =
  | ConvertFailure
  // re-serializing never settles on one set of bytes
  | { kind: "unstable" }
  // the file parses, but re-serializing drops content or joins its lines
  | { kind: "roundtrip-loss" }
  // the pipeline threw, or answered a document the editor cannot hold
  | { kind: "pipeline-error" };

// `normalizes`: the first write restyles markup and keeps every letter and line.
/** @internal */
export type DocAnalysis = { kind: "canonical" } | { kind: "normalizes" } | RoundTripFailure;

const describeFailure = (reason: RoundTripFailure): string => {
  switch (reason.kind) {
    case "too-deep": {
      return "the markdown nests deeper than the editor holds";
    }
    case "unstable": {
      return "re-serializing the markdown never settles";
    }
    case "roundtrip-loss": {
      return "re-serializing the markdown changes what it says";
    }
    case "pipeline-error": {
      return "the markdown pipeline failed";
    }
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
};

/** @internal */
export class RoundTripError extends Error {
  readonly reason: RoundTripFailure;

  constructor(reason: RoundTripFailure) {
    super(describeFailure(reason));
    this.name = "RoundTripError";
    this.reason = reason;
  }
}

// fresh per call: Slate editors carry mutable state.
export const headlessEditor = (): SlateEditor => createSlateEditor({ plugins: BASE_KIT });

// the tag the table writer joins a cell's blocks with spells no word of the note
const letters = (s: string): string =>
  s
    .replaceAll(CELL_BREAK, "")
    .replaceAll(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();

const lineEndOffsets = (lines: readonly string[]): number[] => {
  const ends: number[] = [];
  let at = 0;
  for (const line of lines) {
    at += line.length;
    ends.push(at);
  }
  return ends;
};

// A write may restyle markup or split a line (two date chips become two paragraphs), but joining
// two lines changes what the note says without losing a letter: `[[A]]\n[[B]]` as `[[A]][[B]]`.
// So every offset where a source line's letters end must still end a written line.
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
  | { ok: false; reason: RoundTripFailure };

const convert = (md: string): Converted => {
  const editor = headlessEditor();
  const converted = mdToSlate(editor, md);
  if (!converted.ok) {
    return converted;
  }
  // mdast root children are flow content, so every rule yields a block; a text at the root would be
  // a rule bug that Slate's normalizer drops, so it is refused rather than losing it
  if (!ElementApi.isElementList(converted.nodes)) {
    return { ok: false, reason: { kind: "pipeline-error" } };
  }
  return { editor, ok: true, value: converted.nodes };
};

type Serialized = { ok: true; out: string } | { ok: false; reason: RoundTripFailure };

// The one way a value becomes bytes: the rules expect the pre-pass to have run, and Plate's own
// serializeMd skips it.
export const serializeNote = (editor: SlateEditor, value: Value = editor.children): string =>
  serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY, value: pruneForMarkdown(value) });

export interface SpannedNote {
  readonly markdown: string;
  // where each top-level node the rules wrote (a block, or a run of list items as one list) sits
  readonly spans: readonly FlowSpan[];
}

// the same bytes, with where each top-level node landed: what the codec's view of an item maps an
// edit back to its blocks by
export const serializeNoteSpans = (editor: SlateEditor, value: Value): SpannedNote => {
  const recorder = recordFlowSpans();
  const markdown = serializeMd(editor, {
    remarkStringifyOptions: {
      ...MD_STRINGIFY,
      handlers: { ...MD_STRINGIFY.handlers, root: recorder.root },
    },
    value: pruneForMarkdown(value),
  });
  return { markdown, spans: recorder.spans };
};

// stringify overflows the stack short of the depth the conversion reaches
const serialize = (editor: SlateEditor, value: Value): Serialized => {
  const out = withinStack(() => serializeNote(editor, value));
  return out === null ? { ok: false, reason: { kind: "too-deep" } } : { ok: true, out };
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
type Fixpoint = { stable: true; at: string } | { stable: false; reason: RoundTripFailure };

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

/** @internal */
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
  // a write leaves pass-1 bytes and each later one advances the chain, so all of it must keep the
  // text.
  return keepsText(md, out) && keepsText(md, fixpoint.at)
    ? { kind: "normalizes" }
    : { kind: "roundtrip-loss" };
};

/** @internal */
export const parseMarkdown = (
  md: string,
): { ok: true; value: Value } | { ok: false; reason: RoundTripFailure } => {
  const converted = convert(md);
  if (!converted.ok) {
    return converted;
  }
  return { ok: true, value: converted.value };
};

/** @internal */
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

/** @internal */
export const toCanonical = (md: string): string => `${roundTrip(md).trimEnd()}\n`;

// an imported page (the fill's article) written as the editor's own fixpoint: the bytes its
// blocks export as.
export interface ImportedDoc {
  markdown: string;
  // the share of the source's letters and digits the fixpoint still holds, which the caller weighs
  // against a plainer spelling of the same page (an entity decoded, a mailto link unwrapped)
  kept: number;
}

// null when the pipeline cannot settle the page (too deep, never stable, or a throw): a page is
// hostile input, so no failure of the editor's own escapes the fill
export const canonicalizeImported = (md: string): ImportedDoc | null => {
  const sourceLetters = letters(md).length;
  if (md.trim() === "") {
    return { kept: 1, markdown: "" };
  }
  let markdown: string;
  try {
    markdown = toCanonical(md);
    if (analyzeMarkdown(markdown).kind !== "canonical") {
      return null;
    }
  } catch {
    return null;
  }
  const keptLetters = letters(markdown).length;
  const kept = sourceLetters === 0 ? 1 : Math.min(keptLetters, sourceLetters) / sourceLetters;
  return { kept, markdown };
};
