// Vendored from ProseMark (github.com/jsimonrichard/ProseMark), MIT.
// (c) J. Simon Richard. See PROVENANCE.md for the pinned commit and local patches.

import { Tag } from '@lezer/highlight';

export const markdownTags = {
  headerMark: Tag.define(),
  fencedCode: Tag.define(),
  linkURL: Tag.define(),
  escapeMark: Tag.define(),
  emoji: Tag.define(),
  emojiMark: Tag.define(),
  listMark: Tag.define(),
  dash: Tag.define(),
};
