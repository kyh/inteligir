// Vendored from ProseMark (github.com/jsimonrichard/ProseMark), MIT.
// (c) J. Simon Richard. See PROVENANCE.md for the pinned commit and local patches.

// PATCHED: the emoji fold (fold/emoji.ts) is not vendored — it is the one
// module that depends on node-emoji, which is out of scope for the first cut.
import { blockQuoteExtension } from '../blockQuote';
import { bulletListExtension } from './bulletList';
import { dashExtension } from './dashes';
import { horizonalRuleExtension } from './horizontalRule';
import { imageExtension } from './image';
import { taskExtension } from './task';

export {
  foldExtension,
  foldableSyntaxFacet,
  selectAllDecorationsOnSelectExtension,
} from './core';
export { bulletListExtension } from './bulletList';
export { dashMarkdownSyntaxExtension, dashExtension } from './dashes';
export { horizonalRuleExtension } from './horizontalRule';
export { imageExtension } from './image';
export { taskExtension } from './task';
export { blockQuoteExtension } from '../blockQuote';

export const defaultFoldableSyntaxExtensions = [
  blockQuoteExtension,
  bulletListExtension,
  taskExtension,
  imageExtension,
  horizonalRuleExtension,
  dashExtension,
];
