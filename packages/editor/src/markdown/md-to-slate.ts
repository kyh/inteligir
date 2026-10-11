// The one markdown→Slate conversion, so the gate, a paste and a template refuse the same inputs
// for the same reasons. BASE_KIT-free on purpose: markdown-kit's paste parser runs it, and the
// kit is part of BASE_KIT.

import { getMergedOptionsDeserialize, mdastToSlate } from "@platejs/markdown";
import type { Descendant, SlateEditor } from "platejs";

import { parseMdast } from "@repo/notes/markdown/parse";

// the parse is total, so nesting is the one thing a conversion can refuse
export interface ConvertFailure {
  kind: "too-deep";
}

type MdToSlate = { ok: true; nodes: Descendant[] } | { ok: false; reason: ConvertFailure };

// mdast→Slate overflows the stack around nesting depth ~1250 (micromark survives to ~6-8k); a
// RangeError is a depth failure, anything else is a real bug and rethrows.
export const mdToSlate = (editor: SlateEditor, md: string): MdToSlate => {
  try {
    const { root } = parseMdast(md);
    return { nodes: mdastToSlate(root, getMergedOptionsDeserialize(editor)), ok: true };
  } catch (error) {
    if (error instanceof RangeError) {
      return { ok: false, reason: { kind: "too-deep" } };
    }
    throw error;
  }
};
