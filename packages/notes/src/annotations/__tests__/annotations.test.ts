import { describe, expect, it } from "vitest";

import {
  addReply,
  addRoot,
  deleteAnnotation,
  editEntry,
  foldAnnotations,
  rootOf,
  threadIds,
} from "../annotation-threads";
import { markerRootIds } from "../marker-ids";
import {
  ANNOTATION_ID_RE,
  ANNOTATION_SOURCES,
  annotationSourceLabel,
  mintAnnotationId,
  parseAnnotationStore,
  serializeAnnotationStore,
} from "../store-schema";
import type { AnnotationEntry, AnnotationStore } from "../store-schema";

const AT = 1_707_900_000;

// a store's insertion order IS its thread order, which these tests assert
const STORE: AnnotationStore = {
  c1: { createdAt: AT, source: "user", text: "Should this ship?", updatedAt: AT },
  "c1-r1": {
    createdAt: AT + 100,
    parentId: "c1",
    source: "external",
    text: "Reflected in the plan.",
    updatedAt: AT + 100,
  },
  "c1-r2": {
    createdAt: AT + 200,
    parentId: "c1-r1",
    source: "agent",
    text: "Nested follow-up.",
    updatedAt: AT + 200,
  },
  b9: { createdAt: AT, source: "user", text: "Unanchored root.", updatedAt: AT },
};

describe("annotation store schema", () => {
  it("round-trips unknown fields and insertion order", () => {
    // the fixture is the assertion: an unsorted root pair and a foreign field after the known ones
    // is exactly what a round-trip has to give back.
    const raw = `${JSON.stringify(
      {
        z: { text: "t", createdAt: AT, updatedAt: AT, foreignOnly: { deep: true } },
        a: { text: "u", createdAt: AT, updatedAt: AT, imageUrl: "assets/legacy.png" },
      },
      null,
      2,
    )}\n`;
    const parsed = parseAnnotationStore(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(serializeAnnotationStore(parsed.store)).toBe(raw);
  });

  it("surfaces malformed bytes instead of folding to empty", () => {
    expect(parseAnnotationStore("{not json").ok).toBe(false);
    expect(parseAnnotationStore('{"x": {"text": "missing timestamps"}}').ok).toBe(false);
  });

  it("refuses an id outside the marker alphabet", () => {
    const parsed = parseAnnotationStore(
      JSON.stringify({ "bad id": { createdAt: AT, text: "t", updatedAt: AT } }),
    );
    expect(parsed.ok).toBe(false);
  });

  it("names an entry's author the same on every surface, and claims none for an unsigned one", () => {
    expect(ANNOTATION_SOURCES.map((source) => annotationSourceLabel(source))).toEqual([
      "You",
      "Agent",
      "External",
    ]);
    const unsigned: AnnotationEntry = { createdAt: AT, text: "t", updatedAt: AT };
    expect(annotationSourceLabel(unsigned.source)).toBe("—");
  });
});

describe("markerRootIds", () => {
  it("collects comma-shared ids and ignores fences", () => {
    const source = [
      "A %%i:c1:start%%range%%i:c1:end%% and %%i:a,b:start%%shared%%i:a,b:end%%.",
      "",
      "```",
      "%%i:fenced:start%% literal %%i:fenced:end%%",
      "```",
      "",
    ].join("\n");
    expect(markerRootIds(source)).toEqual(new Set(["c1", "a", "b"]));
  });

  it("reads the markers of a doc holding a tag that cannot pair", () => {
    expect(markerRootIds("%%i:c1:start%%x%%i:c1:end%% <Foo>broken</Bar>\n")).toEqual(
      new Set(["c1"]),
    );
  });
});

describe("foldAnnotations", () => {
  it("builds threads with replies in parent-chain order and flags both orphan directions", () => {
    const folded = foldAnnotations(STORE, new Set(["c1", "ghost"]));
    expect(folded.annotations.map((annotation) => annotation.id)).toEqual(["c1", "b9"]);
    const [c1] = folded.annotations;
    expect(c1?.replies.map((reply) => reply.id)).toEqual(["c1-r1", "c1-r2"]);
    expect(c1?.anchored).toBe(true);
    expect(folded.annotations[1]?.anchored).toBe(false);
    expect(folded.orphanMarkers).toEqual(["ghost"]);
    expect(folded.strayIds).toEqual([]);
  });

  it("lists anchored roots in the order their markers open, then the unanchored by creation", () => {
    const store: AnnotationStore = {
      late: { createdAt: AT + 9, text: "", updatedAt: AT + 9 },
      top: { createdAt: AT + 5, text: "", updatedAt: AT + 5 },
      early: { createdAt: AT + 1, text: "", updatedAt: AT + 1 },
      bottom: { createdAt: AT, text: "", updatedAt: AT },
    };
    const source = "%%i:top:start%%a%%i:top:end%% then %%i:bottom:start%%b%%i:bottom:end%%\n";
    expect(
      foldAnnotations(store, markerRootIds(source)).annotations.map((annotation) => annotation.id),
    ).toEqual(["top", "bottom", "early", "late"]);
  });

  it("surfaces dangling and cyclic chains as strays", () => {
    const broken: AnnotationStore = {
      ...STORE,
      dangling: { createdAt: AT, parentId: "gone", text: "x", updatedAt: AT },
      loopA: { createdAt: AT, parentId: "loopB", text: "x", updatedAt: AT },
      loopB: { createdAt: AT, parentId: "loopA", text: "x", updatedAt: AT },
    };
    const folded = foldAnnotations(broken, new Set(["c1"]));
    expect(folded.strayIds.toSorted()).toEqual(["dangling", "loopA", "loopB"]);
    expect(rootOf(broken, "loopA")).toBeNull();
    expect(rootOf(broken, "dangling")).toBeNull();
  });

  it("claims nothing about markers when the doc was unparseable", () => {
    const folded = foldAnnotations(STORE, null);
    expect(folded.orphanMarkers).toEqual([]);
    expect(folded.annotations.every((annotation) => annotation.anchored)).toBe(true);
  });
});

describe("transforms", () => {
  it("addRoot refuses a taken id and appends in insertion order", () => {
    expect(addRoot(STORE, { at: AT, id: "c1", source: "user", text: "x" }).ok).toBe(false);
    const added = addRoot(STORE, { at: AT + 5, id: "n1", source: "user", text: "x" });
    expect(added.ok).toBe(true);
    if (!added.ok) {
      return;
    }
    expect(Object.keys(added.store).at(-1)).toBe("n1");
    expect(STORE.n1).toBeUndefined();
  });

  it("addRoot keeps a bare highlight's quote, and a parse gives it back", () => {
    const added = addRoot(STORE, {
      at: AT,
      id: "h1",
      quote: "the passage",
      source: "user",
      text: "",
    });
    expect(added.ok).toBe(true);
    if (!added.ok) {
      return;
    }
    const parsed = parseAnnotationStore(serializeAnnotationStore(added.store));
    expect(parsed.ok ? parsed.store.h1 : null).toEqual({
      createdAt: AT,
      quote: "the passage",
      source: "user",
      text: "",
      updatedAt: AT,
    });
  });

  it("addReply requires a parent reachable from a root", () => {
    expect(
      addReply(STORE, { at: AT, id: "r9", parentId: "missing", source: "agent", text: "x" }).ok,
    ).toBe(false);
    const nested = addReply(STORE, {
      at: AT,
      id: "r9",
      parentId: "c1-r2",
      source: "agent",
      text: "x",
    });
    expect(nested.ok).toBe(true);
  });

  it("editEntry rewrites one entry's text in place, signed by its writer, and refuses an unknown id", () => {
    const edited = editEntry(STORE, { at: AT + 9, id: "c1", source: "agent", text: "Ship it." });
    expect(edited.ok).toBe(true);
    if (!edited.ok) {
      return;
    }
    expect(Object.keys(edited.store)).toEqual(Object.keys(STORE));
    expect(edited.store.c1).toEqual({
      createdAt: AT,
      source: "agent",
      text: "Ship it.",
      updatedAt: AT + 9,
    });
    expect(editEntry(STORE, { at: AT, id: "nope", source: "user", text: "x" }).ok).toBe(false);
  });

  it("deleteAnnotation removes the whole chain and answers which ids died", () => {
    const deleted = deleteAnnotation(STORE, "c1");
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) {
      return;
    }
    expect(deleted.removedIds.toSorted()).toEqual(["c1", "c1-r1", "c1-r2"]);
    expect(Object.keys(deleted.store)).toEqual(["b9"]);
    expect(threadIds(STORE, "c1").toSorted()).toEqual(["c1", "c1-r1", "c1-r2"]);
  });

  it("deleteAnnotation refuses a reply id", () => {
    expect(deleteAnnotation(STORE, "c1-r1").ok).toBe(false);
  });
});

const webRandomBytes = (length: number): Uint8Array =>
  globalThis.crypto.getRandomValues(new Uint8Array(length));

describe("mintAnnotationId", () => {
  it("mints ids the marker grammar accepts, from the lowercase alphabet", () => {
    const minted = Array.from({ length: 50 }, () => mintAnnotationId(webRandomBytes));
    for (const id of minted) {
      expect(id).toMatch(/^[a-z0-9]{10}$/u);
      expect(id).toMatch(ANNOTATION_ID_RE);
    }
    expect(new Set(minted).size).toBe(minted.length);
  });

  it("draws every character from the bytes it is handed", () => {
    expect(mintAnnotationId((length) => new Uint8Array(length).fill(36 + 1))).toBe("bbbbbbbbbb");
  });

  it("mints an id that round-trips through the body marker grammar", () => {
    const id = mintAnnotationId(webRandomBytes);
    expect(markerRootIds(`The %%i:${id}:start%%plan%%i:${id}:end%% holds.\n`)).toEqual(
      new Set([id]),
    );
  });

  it("parses a marker for every character the id alphabet admits", () => {
    const id = "Az09_-";
    expect(id).toMatch(ANNOTATION_ID_RE);
    expect(markerRootIds(`%%i:${id},b:start%%x%%i:${id},b:end%%\n`)).toEqual(new Set([id, "b"]));
  });
});
