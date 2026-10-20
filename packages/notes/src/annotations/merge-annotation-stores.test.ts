import { describe, expect, it } from "vitest";
import { mergeAnnotationStores } from "./merge-annotation-stores";
import { parseAnnotationStore, serializeAnnotationStore } from "./store-schema";
import type { AnnotationEntry, AnnotationStore } from "./store-schema";

const AT = 1_707_900_000;

const entry = (text: string, fields: Partial<AnnotationEntry> = {}): AnnotationEntry => ({
  createdAt: AT,
  source: "user",
  text,
  updatedAt: AT,
  ...fields,
});

const store = (entries: AnnotationStore): string => serializeAnnotationStore(entries);

const mergedStore = (base: string | null, mine: string, theirs: string): AnnotationStore => {
  const merged = mergeAnnotationStores({ base, mine, theirs });
  if (merged.kind !== "merged") {
    throw new Error(`expected a merge, got ${merged.kind}`);
  }
  const parsed = parseAnnotationStore(merged.text);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.store;
};

describe("mergeAnnotationStores", () => {
  const c1 = entry("Why Friday?");

  it("keeps every annotation either side added, mine's first", () => {
    const merged = mergedStore(
      store({ c1 }),
      store({ c1, m1: entry("mine") }),
      store({ c1, t1: entry("theirs") }),
    );
    expect(merged).toEqual({ c1, m1: entry("mine"), t1: entry("theirs") });
    expect(Object.keys(merged)).toEqual(["c1", "m1", "t1"]);
  });

  it("unions two stores with no common version", () => {
    expect(mergedStore(null, store({ m1: entry("mine") }), store({ t1: entry("theirs") }))).toEqual(
      { m1: entry("mine"), t1: entry("theirs") },
    );
  });

  it("keeps the later edit of an annotation both sides changed", () => {
    const later = entry("theirs, later", { updatedAt: AT + 20 });
    expect(
      mergedStore(
        store({ c1 }),
        store({ c1: entry("mine", { updatedAt: AT + 10 }) }),
        store({ c1: later }),
      ),
    ).toEqual({ c1: later });
  });

  it("keeps mine when both edits carry the same time", () => {
    const mine = entry("mine", { updatedAt: AT + 10 });
    expect(
      mergedStore(
        store({ c1 }),
        store({ c1: mine }),
        store({ c1: entry("theirs", { updatedAt: AT + 10 }) }),
      ),
    ).toEqual({ c1: mine });
  });

  it("takes a note one side wrote while the other left the highlight alone", () => {
    const noted = entry("Why Friday? Thursday works.", { updatedAt: AT + 5 });
    expect(mergedStore(store({ c1 }), store({ c1 }), store({ c1: noted }))).toEqual({
      c1: noted,
    });
  });

  it("drops an annotation one side deleted and the other left alone", () => {
    expect(
      mergedStore(
        store({ c1, c2: entry("second") }),
        store({ c2: entry("second") }),
        store({ c1, c2: entry("second"), t1: entry("theirs") }),
      ),
    ).toEqual({ c2: entry("second"), t1: entry("theirs") });
  });

  it("keeps an annotation one side deleted and the other edited", () => {
    const edited = entry("Why not Friday?", { updatedAt: AT + 30 });
    expect(mergedStore(store({ c1 }), store({}), store({ c1: edited }))).toEqual({ c1: edited });
    expect(mergedStore(store({ c1 }), store({ c1: edited }), store({}))).toEqual({ c1: edited });
  });

  it("keeps a thread one side deleted when the other replied to it", () => {
    const reply = entry("Because of the launch.", { parentId: "c1" });
    expect(mergedStore(store({ c1 }), store({}), store({ c1, r1: reply }))).toEqual({
      c1,
      r1: reply,
    });
  });

  it("answers mine's own bytes when the merge is mine", () => {
    const mine = `{"c1":${JSON.stringify(c1)},"m1":${JSON.stringify(entry("mine"))}}`;
    expect(mergeAnnotationStores({ base: store({ c1 }), mine, theirs: store({ c1 }) })).toEqual({
      kind: "merged",
      text: mine,
    });
  });

  it("refuses to merge a side it cannot read, rather than reading it as empty", () => {
    const readable = store({ c1 });
    expect(mergeAnnotationStores({ base: readable, mine: readable, theirs: "{ not json" })).toEqual(
      {
        kind: "unreadable",
      },
    );
    expect(mergeAnnotationStores({ base: readable, mine: '{"c1": 3}', theirs: readable })).toEqual({
      kind: "unreadable",
    });
  });
});
