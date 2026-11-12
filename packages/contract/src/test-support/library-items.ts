// Items' fields and blocks for the library model's suites, built by hand.

import { blankItemFields } from "../library/item-makes";
import type { LibraryItemFields } from "../library/library-item";
import type { LibraryBlock } from "../library/library-nodes";

export const noteFixture = (overrides: Partial<LibraryItemFields> = {}): LibraryItemFields => ({
  ...blankItemFields(1_700_000_000_000),
  title: "A note",
  ...overrides,
});

export const paragraph = (id: string, text: string): LibraryBlock => ({
  children: [{ text }],
  id,
  type: "p",
});
