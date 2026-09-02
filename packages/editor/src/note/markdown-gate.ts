// the one file in ./note that knows a rich editor exists; an editor whose document
// is the markdown text itself makes this `() => null` and nothing above it changes.

import {
  type GateReason,
  analyzeMarkdown,
  describeGateReason,
  gateReasonFor,
} from "@repo/editor/markdown/markdown-doc";

export type { GateReason };
export { describeGateReason };

// classified with the full round-trip oracle so a serializer bug gates the file
// to raw instead of letting the first rich save persist corrupted bytes; a pipeline
// throw degrades to raw too. the oracle sees bytes at open and at save-settle, so a
// bug triggered only by newly-typed content lands one corrupt save before the gate flips.
export function safeGateReason(md: string): GateReason | null {
  try {
    return gateReasonFor(analyzeMarkdown(md));
  } catch (error) {
    console.error("Markdown gate analysis failed", error);
    return { kind: "parse-error", line: null, message: "Editor pipeline error" };
  }
}
