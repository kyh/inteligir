// Vendored from ProseMark (github.com/jsimonrichard/ProseMark), MIT.
// (c) J. Simon Richard. See PROVENANCE.md for the pinned commit and local patches.

import {
  type EditorState,
  StateField,
  type Range,
  Facet,
  EditorSelection,
  type Extension,
} from '@codemirror/state';
import {
  type DOMEventHandlers,
  Decoration,
  type DecorationSet,
  EditorView,
} from '@codemirror/view';
import {
  eventHandlersWithClass,
  type RangeLike,
  selectionTouchesRange,
} from '../utils';

import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common';
import { syntaxTree } from '@codemirror/language';
// PATCHED: house drag-freeze seam, see src/decoration-update-filter.ts.
import { allowsSelectionRebuild } from '../../../../decoration-update-filter';

// PATCHED: upstream built `parents.reverse().join('/')` for EVERY node in the
// document and then suffix-tested it — a string allocation per node per
// keystroke, to answer a question about the node's last few ancestors. This
// consumes the test from its end instead, walking up only as far as the test
// reaches, and keeps `String.endsWith` semantics exactly (a test may end
// mid-name, and `pathEndsWith(node, 'istMark')` still matches a `ListMark`).
const pathEndsWith = (node: SyntaxNodeRef, test: string): boolean => {
  if (!test.includes('/')) {
    return node.name.endsWith(test);
  }
  let rest = test;
  let current: SyntaxNode | null = node.node;
  while (current) {
    const name = current.name;
    if (rest.length <= name.length) {
      return name.endsWith(rest);
    }
    if (!rest.endsWith(name)) {
      return false;
    }
    rest = rest.slice(0, rest.length - name.length);
    if (!rest.endsWith('/')) {
      return false;
    }
    rest = rest.slice(0, -1);
    current = current.parent;
  }
  return rest.length === 0;
};

// The `nodePath` string a FUNCTION spec is handed. Built only for those specs —
// none ship today, and the whole point of pathEndsWith is not paying for it.
const nodePathOf = (node: SyntaxNodeRef): string => {
  const lineage: string[] = [];
  let current: SyntaxNode | null = node.node;
  while (current) {
    lineage.push(current.name);
    current = current.parent;
  }
  return lineage.reverse().join('/');
};

const buildDecorations = (state: EditorState) => {
  const decorations: Range<Decoration>[] = [];
  const specs = state.facet(foldableSyntaxFacet);
  syntaxTree(state).iterate({
    enter: (node) => {
      const selectionTouchesNodeRange = selectionTouchesRange(
        state.selection.ranges,
        node,
      );

      for (const spec of specs) {
        // Check node path
        if (spec.nodePath instanceof Function) {
          if (!spec.nodePath(nodePathOf(node))) {
            continue;
          }
        } else if (spec.nodePath instanceof Array) {
          if (!spec.nodePath.some((testPath) => pathEndsWith(node, testPath))) {
            continue;
          }
        } else if (!pathEndsWith(node, spec.nodePath)) {
          continue;
        }

        // Check custom unfold zone
        const selectionTouchesRange_ = spec.unfoldZone
          ? selectionTouchesRange(
              state.selection.ranges,
              spec.unfoldZone(state, node),
            )
          : selectionTouchesNodeRange;

        if (!spec.keepDecorationOnUnfold && selectionTouchesRange_) {
          return;
        }

        // Run folding logic
        if (spec.buildDecorations) {
          const res = spec.buildDecorations(
            state,
            node,
            selectionTouchesRange_,
          );
          if (res instanceof Array) {
            decorations.push(...res);
          } else if (res) {
            decorations.push(res);
          }
        }
      }
    },
  });
  return Decoration.set(decorations, true);
};

export const foldExtension = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state);
  },

  update(deco, tr) {
    if (
      tr.docChanged ||
      // PATCHED: selection-only rebuilds go through the drag-freeze seam.
      (tr.selection !== undefined && allowsSelectionRebuild(tr)) ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state)
    ) {
      return buildDecorations(tr.state);
    }
    return deco.map(tr.changes);
  },
  provide: (f) => [EditorView.decorations.from(f)],
});

export interface FoldableSyntaxSpec {
  nodePath: string | string[] | ((nodePath: string) => boolean);
  buildDecorations?: (
    state: EditorState,
    node: SyntaxNodeRef,
    selectionTouchesRange: boolean,
  ) => Range<Decoration> | Range<Decoration>[] | undefined;
  unfoldZone?: (state: EditorState, node: SyntaxNodeRef) => RangeLike;
  eventHandlers?: DOMEventHandlers<void>;
  keepDecorationOnUnfold?: boolean;
}

export const foldableSyntaxFacet = Facet.define<
  FoldableSyntaxSpec,
  FoldableSyntaxSpec[]
>({
  combine(value: readonly FoldableSyntaxSpec[]) {
    return [...value];
  },
  enables: foldExtension,
});

export const selectAllDecorationsOnSelectExtension = (
  widgetClass: string,
): Extension =>
  EditorView.domEventHandlers(
    eventHandlersWithClass({
      mousedown: {
        [widgetClass]: (e: MouseEvent, view: EditorView) => {
          // Change selection when appropriate so that the content can be edited
          // (selection by mouse would overshoot the widget content range)

          const ranges = view.state.selection.ranges;
          if (ranges.length === 0 || ranges[0]?.anchor !== ranges[0]?.head)
            return;

          const target = e.target as HTMLElement;
          const pos = view.posAtDOM(target);

          const decorations = view.state.field(foldExtension);
          decorations.between(pos, pos, (from: number, to: number) => {
            setTimeout(() => {
              view.dispatch({
                selection: EditorSelection.single(to, from),
              });
            }, 0);
            return false;
          });
        },
      },
    }),
  );
