// the server hands the engine's rows to these schemas unchanged, so a field on one side only is a
// row the other misreads; structural assignment lets an added engine field through, equality
// does not. a failure here is a compile error under `tsc`, not a failed run.

import type { SearchResult } from "@repo/notes/knowledge/knowledge-index";
import type { LinkKind } from "@repo/notes/knowledge/link-kinds";
import type { BacklinkEntry, WikiTarget } from "@repo/notes/knowledge/link-graph-index";
import type { RelatedNoteEntry } from "@repo/notes/knowledge/related-notes";
import type { TagCount } from "@repo/notes/knowledge/tag-index";
import type { VaultMatch } from "@repo/notes/knowledge/text-matches";
import type { UnlinkedMention } from "@repo/notes/knowledge/unlinked-mentions";
import type {
  DuplicateIdRow,
  DuplicateStemRow,
  OrphanRow,
  UnresolvedLinkRow,
} from "@repo/notes/knowledge/vault-problems";
import { describe, expectTypeOf, it } from "vitest";
import type {
  BacklinkEntryWire,
  DuplicateIdRowWire,
  DuplicateStemRowWire,
  LinkKindWire,
  OrphanRowWire,
  RelatedNoteWire,
  SearchResultWire,
  TagCountWire,
  UnlinkedMentionWire,
  UnresolvedLinkRowWire,
  VaultMatchWire,
  WikiTargetWire,
} from "../knowledge-schema";

describe("each knowledge wire row is its engine type", () => {
  it("search, links and targets", () => {
    expectTypeOf<SearchResultWire>().toEqualTypeOf<SearchResult>();
    expectTypeOf<LinkKindWire>().toEqualTypeOf<LinkKind>();
    expectTypeOf<BacklinkEntryWire>().toEqualTypeOf<BacklinkEntry>();
    expectTypeOf<WikiTargetWire>().toEqualTypeOf<WikiTarget>();
    expectTypeOf<RelatedNoteWire>().toEqualTypeOf<RelatedNoteEntry>();
    expectTypeOf<TagCountWire>().toEqualTypeOf<TagCount>();
  });

  it("the literal scan's rows", () => {
    // the engine spells VaultMatch as an intersection, which only the branded comparison flattens
    expectTypeOf<VaultMatchWire>().branded.toEqualTypeOf<VaultMatch>();
    expectTypeOf<UnlinkedMentionWire>().toEqualTypeOf<UnlinkedMention>();
  });

  it("the problems report's rows", () => {
    expectTypeOf<UnresolvedLinkRowWire>().toEqualTypeOf<UnresolvedLinkRow>();
    expectTypeOf<OrphanRowWire>().toEqualTypeOf<OrphanRow>();
    expectTypeOf<DuplicateStemRowWire>().toEqualTypeOf<DuplicateStemRow>();
    expectTypeOf<DuplicateIdRowWire>().toEqualTypeOf<DuplicateIdRow>();
  });
});
