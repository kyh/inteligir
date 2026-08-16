// Vendored from ProseMark (github.com/jsimonrichard/ProseMark), MIT.
// (c) J. Simon Richard. See PROVENANCE.md for the pinned commit and local patches.

export * from './hide';
export * from './fold';
export * from './revealBlockOnArrow';
export * from './syntaxHighlighting';
export * from './markdown';
export * from './clickLink';
export * from './softIndentExtension';
export * from './tabWidthExtension';
export * from './codeFenceExtension';

export * from './basicSetup';

export {
  prosemarkMarkdownFormattingKeymap,
  prosemarkMarkdownFormattingKeymapExtension,
} from './markdownFormattingKeymap';

export { eventHandlersWithClass } from './utils';
