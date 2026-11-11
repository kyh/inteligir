// Items' fields and blocks for the library model's suites, built by hand.

import type { LibraryItemFields } from "../library/library-item";
import type { LibraryBlock } from "../library/library-nodes";

export const noteFields = (overrides: Partial<LibraryItemFields> = {}): LibraryItemFields => ({
  aliases: [],
  author: null,
  coverSha: null,
  deletedAt: null,
  description: null,
  fetchError: null,
  fetchState: "none",
  fetchedAt: null,
  folderId: null,
  kind: "note",
  lang: null,
  originalName: null,
  originalSha: null,
  pinnedAt: null,
  properties: {},
  published: null,
  savedAt: 1_700_000_000_000,
  site: null,
  tags: [],
  title: "A note",
  url: null,
  ...overrides,
});

export const paragraph = (id: string, text: string): LibraryBlock => ({
  children: [{ text }],
  id,
  type: "p",
});
