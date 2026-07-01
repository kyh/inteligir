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

import { BASE_KIT } from "@repo/app/editor/kits/base-kit";
import { MD_STRINGIFY } from "@repo/app/editor/markdown/md-plugins";
import { parseMdast } from "@repo/app/editor/markdown/parse";
import { type RawReason, scanVocabulary } from "@repo/app/editor/markdown/vocabulary";

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
  const value = mdastToSlate(parsed.root, getMergedOptionsDeserialize(editor));
  return { editor, ok: true, value };
}

function serialize(editor: ReturnType<typeof makeEditor>, value: Descendant[]): string {
  return serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY, value });
}

/** Classify `md` in ONE parse+serialize pass (call once per content change). */
export function analyzeMarkdown(md: string): DocAnalysis {
  if (md.trim() === "") return { canonical: true, rawReason: null, richSafe: true };
  const converted = convert(md);
  if (!converted.ok) return { canonical: false, rawReason: converted.reason, richSafe: false };
  const out = serialize(converted.editor, converted.value);
  const canonical = out.trimEnd() === md.trimEnd();
  const richSafe = canonical || letters(md) === letters(out);
  return { canonical, rawReason: null, richSafe };
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

/** Serialize the parse of `md` — the pipeline's canonical form of the document.
 * Throws ParseFailedError when the file can't round-trip (parse/scan failure). */
export function roundTrip(md: string): string {
  const converted = convert(md);
  if (!converted.ok) throw new ParseFailedError(converted.reason);
  return serialize(converted.editor, converted.value);
}

/** Canonicalize `md` (the one-time Format action). Idempotent thereafter.
 * Throws ParseFailedError when there is nothing safe to format to. */
export function toCanonical(md: string): string {
  return roundTrip(md).trimEnd() + "\n";
}
