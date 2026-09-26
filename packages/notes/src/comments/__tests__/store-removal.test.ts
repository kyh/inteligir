import { describe, expect, it } from "vitest";
import { commentStoresFreedBy } from "../store-removal";

const ID = "9e64c3df-c1e2-4a4d-8c07-91528f422413";
const OTHER_ID = "0d9c2a77-5f31-4c3b-9d5e-2b7f1a3c4e60";

const ownersOf =
  (carriers: Record<string, readonly string[]>) =>
  (id: string): readonly string[] =>
    carriers[id] ?? [];

describe("the comment stores a delete takes", () => {
  it("takes the removed note's store when no other note carries its id", () => {
    expect(
      commentStoresFreedBy([{ noteId: ID, path: "plan.md" }], ownersOf({ [ID]: ["plan.md"] })),
    ).toStrictEqual([`.inteligir/comments/${ID}.json`]);
  });

  it("keeps a store whose id a note that stays still carries", () => {
    expect(
      commentStoresFreedBy(
        [{ noteId: ID, path: "plan.md" }],
        ownersOf({ [ID]: ["plan.md", "plan copy.md"] }),
      ),
    ).toStrictEqual([]);
  });

  it("takes a shared store when every note carrying the id goes together", () => {
    expect(
      commentStoresFreedBy(
        [
          { noteId: ID, path: "proj/plan.md" },
          { noteId: ID, path: "proj/plan copy.md" },
          { noteId: OTHER_ID, path: "proj/notes.md" },
          { noteId: null, path: "proj/bare.md" },
        ],
        ownersOf({ [ID]: ["proj/plan.md", "proj/plan copy.md"], [OTHER_ID]: ["proj/notes.md"] }),
      ).toSorted(),
    ).toStrictEqual([`.inteligir/comments/${OTHER_ID}.json`, `.inteligir/comments/${ID}.json`]);
  });

  it("takes nothing for a note without an id, or with one no store is keyed by", () => {
    expect(
      commentStoresFreedBy(
        [
          { noteId: null, path: "bare.md" },
          { noteId: "../escape", path: "odd.md" },
        ],
        ownersOf({}),
      ),
    ).toStrictEqual([]);
  });
});
