// Where each of a root's children lands in the markdown a stringify writes. The handler joins the
// children as mdast-util-to-markdown's own `containerFlow` does (each written with a blank line's
// context, the lines between two blocks from the state's join rules, a comment between two that
// cannot touch), and notes where each child's bytes start and end, so a caller can say which
// part of the text a block wrote.

import type { Parents, Root } from "mdast";
import type { Handle, Info, Join, State } from "mdast-util-to-markdown";

// the flow content a join rule weighs, and the parents it weighs it in
type FlowChild = Parameters<Join>[0];
type FlowParent = Parameters<Join>[2];

export interface FlowSpan {
  readonly start: number;
  readonly end: number;
}

type JoinAnswer = ReturnType<Join>;

// a join rule's number: how many blank lines it asks for
const isLineCount = (answer: JoinAnswer): answer is number => typeof answer === "number";

// what mdast-util-to-markdown writes between two flow siblings
const between = (left: FlowChild, right: FlowChild, parent: FlowParent, state: State): string => {
  for (let index = state.join.length - 1; index >= 0; index -= 1) {
    const result = state.join[index]?.(left, right, parent, state);
    if (result === true || result === 1) {
      break;
    }
    if (isLineCount(result)) {
      return "\n".repeat(1 + result);
    }
    if (result === false) {
      return "\n\n<!---->\n\n";
    }
  }
  return "\n\n";
};

export interface FlowRecorder {
  // a `root` handler for stringify's options; it writes the root as the default one does
  readonly root: Handle;
  // each root child's span in the text, filled as the root is written
  readonly spans: readonly FlowSpan[];
}

export const recordFlowSpans = (): FlowRecorder => {
  const spans: FlowSpan[] = [];
  const root = (node: Root, _parent: Parents | undefined, state: State, info: Info): string => {
    const children: readonly FlowChild[] = node.children;
    const tracker = state.createTracker(info);
    let written = "";
    state.indexStack.push(-1);
    for (const [index, child] of children.entries()) {
      state.indexStack[state.indexStack.length - 1] = index;
      const out = tracker.move(
        state.handle(child, node, state, { after: "\n", before: "\n", ...tracker.current() }),
      );
      spans.push({ end: written.length + out.length, start: written.length });
      written += out;
      if (child.type !== "list") {
        state.bulletLastUsed = undefined;
      }
      const next = children[index + 1];
      if (next !== undefined) {
        written += tracker.move(between(child, next, node, state));
      }
    }
    state.indexStack.pop();
    return written;
  };
  return { root, spans };
};
