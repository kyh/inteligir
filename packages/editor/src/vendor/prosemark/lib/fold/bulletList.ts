// Vendored from ProseMark (github.com/jsimonrichard/ProseMark), MIT.
// (c) J. Simon Richard. See PROVENANCE.md for the pinned commit and local patches.

import { Decoration, WidgetType } from '@codemirror/view';
import { foldableSyntaxFacet } from './core';

class BulletPoint extends WidgetType {
  override eq(other: BulletPoint): boolean {
    return other instanceof BulletPoint;
  }

  override toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-rendered-list-mark';
    span.innerHTML = '•';
    return span;
  }

  override ignoreEvent(_event: Event) {
    return false;
  }
}

export const bulletListExtension = foldableSyntaxFacet.of({
  nodePath: 'BulletList/ListItem/ListMark',
  buildDecorations: (_state, node) => {
    const cursor = node.node.cursor();
    if (cursor.nextSibling() && cursor.name === 'Task') return;

    return Decoration.replace({ widget: new BulletPoint() }).range(
      node.from,
      node.to,
    );
  },
});
