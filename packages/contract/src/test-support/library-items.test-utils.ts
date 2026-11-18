import { blankItemFields } from "../library/item-makes";
import type { LibraryItemFields } from "../library/library-item";
import type { LibraryBlock } from "../library/library-nodes";

export const noteFixture = (overrides: Partial<LibraryItemFields> = {}) =>
  ({
    ...blankItemFields(1_700_000_000_000),
    title: "A note",
    ...overrides,
  }) satisfies LibraryItemFields;

export const paragraph = (id: string, text: string) =>
  ({
    children: [{ text }],
    id,
    type: "p",
  }) satisfies LibraryBlock;

export const pillParagraph = (id: string, source: string, display: string) =>
  ({
    children: [{ children: [{ text: "" }], display, source, type: "formulaPill" }],
    id,
    type: "p",
  }) satisfies LibraryBlock;
