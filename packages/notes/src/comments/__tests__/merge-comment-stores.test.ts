import { describe, expect, it } from "vitest";
import { mergeCommentStores } from "../merge-comment-stores";
import { parseSidecar, serializeSidecar } from "../sidecar-schema";
import type { CommentEntry, CommentSidecar } from "../sidecar-schema";

const AT = 1_707_900_000;

const entry = (text: string, fields: Partial<CommentEntry> = {}): CommentEntry => ({
  createdAt: AT,
  source: "user",
  text,
  updatedAt: AT,
  ...fields,
});

const store = (sidecar: CommentSidecar): string => serializeSidecar(sidecar);

const mergedSidecar = (base: string | null, mine: string, theirs: string): CommentSidecar => {
  const merged = mergeCommentStores({ base, mine, theirs });
  if (merged.kind !== "merged") {
    throw new Error(`expected a merge, got ${merged.kind}`);
  }
  const parsed = parseSidecar(merged.text);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.sidecar;
};

describe("mergeCommentStores", () => {
  const c1 = entry("Why Friday?");

  it("keeps every comment either side added, mine's first", () => {
    const merged = mergedSidecar(
      store({ c1 }),
      store({ c1, m1: entry("mine") }),
      store({ c1, t1: entry("theirs") }),
    );
    expect(merged).toEqual({ c1, m1: entry("mine"), t1: entry("theirs") });
    expect(Object.keys(merged)).toEqual(["c1", "m1", "t1"]);
  });

  it("unions two stores with no common version", () => {
    expect(
      mergedSidecar(null, store({ m1: entry("mine") }), store({ t1: entry("theirs") })),
    ).toEqual({ m1: entry("mine"), t1: entry("theirs") });
  });

  it("keeps the later edit of a comment both sides changed", () => {
    const later = entry("theirs, later", { updatedAt: AT + 20 });
    expect(
      mergedSidecar(
        store({ c1 }),
        store({ c1: entry("mine", { updatedAt: AT + 10 }) }),
        store({ c1: later }),
      ),
    ).toEqual({ c1: later });
  });

  it("keeps mine when both edits carry the same time", () => {
    const mine = entry("mine", { updatedAt: AT + 10 });
    expect(
      mergedSidecar(
        store({ c1 }),
        store({ c1: mine }),
        store({ c1: entry("theirs", { updatedAt: AT + 10 }) }),
      ),
    ).toEqual({ c1: mine });
  });

  it("takes a resolve one side made while the other left the thread alone", () => {
    const resolved = entry("Why Friday?", { resolvedAt: AT + 5, resolvedBy: "user" });
    expect(mergedSidecar(store({ c1 }), store({ c1 }), store({ c1: resolved }))).toEqual({
      c1: resolved,
    });
  });

  it("drops a comment one side deleted and the other left alone", () => {
    expect(
      mergedSidecar(
        store({ c1, c2: entry("second") }),
        store({ c2: entry("second") }),
        store({ c1, c2: entry("second"), t1: entry("theirs") }),
      ),
    ).toEqual({ c2: entry("second"), t1: entry("theirs") });
  });

  it("keeps a comment one side deleted and the other edited", () => {
    const edited = entry("Why not Friday?", { updatedAt: AT + 30 });
    expect(mergedSidecar(store({ c1 }), store({}), store({ c1: edited }))).toEqual({ c1: edited });
    expect(mergedSidecar(store({ c1 }), store({ c1: edited }), store({}))).toEqual({ c1: edited });
  });

  it("keeps a thread one side deleted when the other replied to it", () => {
    const reply = entry("Because of the launch.", { parentId: "c1" });
    expect(mergedSidecar(store({ c1 }), store({}), store({ c1, r1: reply }))).toEqual({
      c1,
      r1: reply,
    });
  });

  it("answers mine's own bytes when the merge is mine", () => {
    const mine = `{"c1":${JSON.stringify(c1)},"m1":${JSON.stringify(entry("mine"))}}`;
    expect(mergeCommentStores({ base: store({ c1 }), mine, theirs: store({ c1 }) })).toEqual({
      kind: "merged",
      text: mine,
    });
  });

  it("refuses to merge a side it cannot read, rather than reading it as empty", () => {
    const readable = store({ c1 });
    expect(mergeCommentStores({ base: readable, mine: readable, theirs: "{ not json" })).toEqual(
      expect.objectContaining({ kind: "unreadable", side: "theirs" }),
    );
    expect(mergeCommentStores({ base: readable, mine: '{"c1": 3}', theirs: readable })).toEqual(
      expect.objectContaining({ kind: "unreadable", side: "mine" }),
    );
  });
});
