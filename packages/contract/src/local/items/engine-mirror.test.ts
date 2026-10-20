// the server hands the library index's rows to these schemas unchanged, so a field on one side
// only is a row the other misreads. a failure here is a compile error under `tsc`.

import type { AnnotationThread } from "@repo/notes/annotations/annotation-threads";
import type { AnnotationEntry } from "@repo/notes/annotations/store-schema";
import type { ItemKind } from "@repo/notes/items/item-kind";
import type { ItemPage, ItemRow, ItemScopes } from "@repo/notes/items/library-index";
import { describe, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type { AnnotationEntryWire, AnnotationWire } from "../annotations/annotations-schema";
import type {
  KnowledgeItemsResponse,
  KnowledgeScopesResponse,
} from "../knowledge/knowledge-schema";
import type { itemKindSchema, ItemFill, ItemRowWire } from "./items-schema";

describe("each library wire row is its engine type", () => {
  it("an item's row and its kind", () => {
    expectTypeOf<ItemRowWire>().toEqualTypeOf<ItemRow>();
    expectTypeOf<z.output<typeof itemKindSchema>>().toEqualTypeOf<ItemKind>();
  });

  it("a page's counts and the scopes the rail lists", () => {
    expectTypeOf<KnowledgeItemsResponse["kindCounts"]>().toEqualTypeOf<ItemPage["kindCounts"]>();
    expectTypeOf<KnowledgeItemsResponse["items"]>().toEqualTypeOf<ItemPage["items"]>();
    expectTypeOf<KnowledgeScopesResponse>().toEqualTypeOf<ItemScopes>();
  });

  it("a fill is pending, filled, or failed with its words, which a row's facts decide", () => {
    expectTypeOf<ItemFill>().toEqualTypeOf<
      { state: "pending" } | { state: "filled" } | { message: string; state: "failed" }
    >();
    // pending is the row's stub flag, and a failure's words are its fetch error
    expectTypeOf<ItemRow["pending"]>().toEqualTypeOf<boolean>();
    expectTypeOf<NonNullable<ItemRow["fetchError"]>>().toEqualTypeOf<
      Extract<ItemFill, { state: "failed" }>["message"]
    >();
  });

  it("an annotation is the fold's thread, its entries the store's declared fields", () => {
    expectTypeOf<AnnotationEntryWire>().toEqualTypeOf<
      Pick<AnnotationEntry, keyof AnnotationEntryWire>
    >();
    expectTypeOf<AnnotationWire["id"]>().toEqualTypeOf<AnnotationThread["id"]>();
    expectTypeOf<AnnotationWire["replies"][number]["id"]>().toEqualTypeOf<
      AnnotationThread["replies"][number]["id"]
    >();
  });
});
