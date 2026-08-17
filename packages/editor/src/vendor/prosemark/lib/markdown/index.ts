// Vendored from ProseMark (github.com/jsimonrichard/ProseMark), MIT.
// (c) J. Simon Richard. See PROVENANCE.md for the pinned commit and local patches.

// PATCHED: emoji syntax removed with the un-vendored emoji fold (node-emoji).
import { dashMarkdownSyntaxExtension } from '../fold';
import { escapeMarkdownSyntaxExtension } from '../hide';
import { additionalMarkdownSyntaxTags } from '../syntaxHighlighting';
import { frontmatterMarkdownSyntaxExtension } from './frontmatter';
import { nestedLinkAsPlainText } from './nestedLinkAsPlainText';
import { mathMarkdownSyntaxExtension } from './mathMarkdown';

export { markdownTags } from './tags';
export {
  FRONTMATTER_LANGUAGE_LABEL,
  isFrontmatterNode,
  frontmatterMarkdownSyntaxExtension,
} from './frontmatter';
export { nestedLinkAsPlainText } from './nestedLinkAsPlainText';
export { escapeMarkdownSyntaxExtension } from '../hide';
export { additionalMarkdownSyntaxTags } from '../syntaxHighlighting';
export { dashMarkdownSyntaxExtension } from '../fold';
export {
  isInlineMathNode,
  mathDelimiterTag,
  mathFormulaTag,
  mathMarkdownSyntaxExtension,
} from './mathMarkdown';

export const prosemarkMarkdownSyntaxExtensions = [
  additionalMarkdownSyntaxTags,
  frontmatterMarkdownSyntaxExtension,
  nestedLinkAsPlainText,
  escapeMarkdownSyntaxExtension,
  dashMarkdownSyntaxExtension,
  mathMarkdownSyntaxExtension,
];
