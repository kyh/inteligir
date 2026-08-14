// ---------------------------------------------------------------------------
// THE editor adapter of the open note — and the only file in ./note that knows
// a rich editor exists.
//
// The open note's own machinery (the controller, the ordering rules, autosave,
// history, the vanish watcher) is editor-independent: it moves text between a
// buffer and the vault. What is NOT independent is the QUESTION this file
// answers — "would re-serializing these bytes change them?" — which exists only
// because the rich surface holds a Slate tree rather than the file, so a save
// round-trips through a translation that can lose content.
//
// Isolated here on purpose. An editor whose document IS the markdown text makes
// `roundTrip(x) === x` a property of the data model rather than a thing to
// measure, and this file becomes `() => null`: the gate stops having anything
// to say and the store above it does not change. That is the whole point of
// the seam — the bet costs one file, not a refactor of the open note.
// ---------------------------------------------------------------------------

import {
  type GateReason,
  analyzeMarkdown,
  describeGateReason,
  gateReasonFor,
} from "@repo/editor/markdown/markdown-doc";

export type { GateReason };
export { describeGateReason };

/**
 * Why these SAVED bytes cannot be edited richly, or null.
 *
 * Classified with the full round-trip oracle (parse + serialize + bounded
 * fixpoint + content-loss check) so a serializer bug gates the file to Raw
 * instead of letting the first Rich save persist corrupted bytes. A pipeline
 * THROW — markdown-doc deliberately rethrows non-depth errors as real bugs —
 * degrades to Raw here too rather than crashing the surface (the seedValue
 * never-crash precedent).
 *
 * Residual window: the oracle sees bytes at open and at save-settle, so a bug
 * triggered only by newly-typed content still lands ONE corrupt save before the
 * post-save re-analysis flips the gate. "File went Raw mid-session" in triage
 * means that save may already be on disk.
 */
export function safeGateReason(md: string): GateReason | null {
  try {
    return gateReasonFor(analyzeMarkdown(md));
  } catch (error) {
    console.error("Markdown gate analysis failed", error);
    return { kind: "parse-error", line: null, message: "Editor pipeline error" };
  }
}
