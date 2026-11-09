// The one markdown→Slate conversion, so the codec and a paste refuse the same inputs for the same
// reasons. BASE_KIT-free on purpose: markdown-kit's paste parser runs it, and the
// kit is part of BASE_KIT.

import { getMergedOptionsDeserialize, mdastToSlate } from "@platejs/markdown";
import type { Root, RootContent } from "mdast";
import type { Descendant, SlateEditor } from "platejs";

import { parseMdast } from "@repo/editor/markdown/parse";

// the parse is total, so nesting is the one thing a conversion can refuse
export interface ConvertFailure {
  kind: "too-deep";
}

type MdToSlate = { ok: true; nodes: Descendant[] } | { ok: false; reason: ConvertFailure };

const TOO_DEEP = { ok: false, reason: { kind: "too-deep" } } as const;

// what `run` answers, or null where it ran past the depth a reading holds. mdast→Slate overflows
// the stack around nesting depth ~1250 (micromark survives to ~6-8k), and a list refuses its own
// depth as that overflow does. V8 says a stack ran out as a RangeError, or as this SyntaxError when
// it ran out compiling a regular expression; anything else is a real bug and rethrows
export const withinStack = <T>(run: () => T): T | null => {
  try {
    return run();
  } catch (error) {
    if (
      error instanceof RangeError ||
      (error instanceof SyntaxError && error.message.endsWith(": Stack overflow"))
    ) {
      return null;
    }
    throw error;
  }
};

export const rootToSlate = (editor: SlateEditor, root: Root): MdToSlate => {
  const nodes = withinStack(() => mdastToSlate(root, getMergedOptionsDeserialize(editor)));
  return nodes === null ? TOO_DEEP : { nodes, ok: true };
};

// `read` reads what the parse's flow holds beyond the grammar, while the tree still shows it
export const mdToSlate = (
  editor: SlateEditor,
  md: string,
  read: (flow: RootContent[]) => RootContent[] = (flow) => flow,
): MdToSlate =>
  withinStack(() => {
    const { root } = parseMdast(md);
    return rootToSlate(editor, { ...root, children: read(root.children) });
  }) ?? TOO_DEEP;
