import { describe, expect, it } from "vitest";

import { markerRootIds } from "../test-support/annotation-markers";
import { foldAnnotations } from "./annotation-threads";
import {
  ANNOTATION_ID_RE,
  ANNOTATION_SOURCES,
  annotationSourceLabel,
  mintAnnotationId,
  parseAnnotationStore,
  sameAnnotationEntry,
  serializeAnnotationStore,
} from "./store-schema";
import type { AnnotationEntry, AnnotationStore } from "./store-schema";

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
  it("reads two entries as one whatever order their fields come in, and any field's change apart", () => {
    const entry = { createdAt: AT, quote: "q", source: "user", text: "t", updatedAt: AT } as const;
    const reordered = {
      updatedAt: AT,
      text: "t",
      source: "user",
      quote: "q",
      createdAt: AT,
    } as const;
    expect(sameAnnotationEntry(entry, reordered)).toBe(true);
    expect(sameAnnotationEntry(entry, { ...reordered, parentId: "p" })).toBe(false);
    expect(sameAnnotationEntry(entry, { ...reordered, quote: "other" })).toBe(false);
  });

  it("round-trips insertion order", () => {
    const raw = `${JSON.stringify(
      {
        z: { text: "t", createdAt: AT, updatedAt: AT },
        a: { text: "u", createdAt: AT, updatedAt: AT },
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
    expect(ANNOTATION_SOURCES.map((source) => annotationSourceLabel(source))).toStrictEqual([
      "You",
      "Agent",
      "External",
    ]);
    const unsigned: AnnotationEntry = { createdAt: AT, text: "t", updatedAt: AT };
    expect(annotationSourceLabel(unsigned.source)).toBe("—");
  });
});

describe(foldAnnotations, () => {
  it("builds threads with replies in parent-chain order", () => {
    const threads = foldAnnotations(STORE, new Set(["c1", "ghost"]));
    expect(threads.map((thread) => thread.id)).toStrictEqual(["c1", "b9"]);
    const [c1] = threads;
    expect(c1?.replies.map((reply) => reply.id)).toStrictEqual(["c1-r1", "c1-r2"]);
    expect(c1?.anchored).toBe(true);
    expect(threads[1]?.anchored).toBe(false);
  });

  it("lists anchored roots in the order their markers open, then the unanchored by creation", () => {
    const store: AnnotationStore = {
      late: { createdAt: AT + 9, text: "", updatedAt: AT + 9 },
      top: { createdAt: AT + 5, text: "", updatedAt: AT + 5 },
      early: { createdAt: AT + 1, text: "", updatedAt: AT + 1 },
      bottom: { createdAt: AT, text: "", updatedAt: AT },
    };
    const source = "%%i:top:start%%a%%i:top:end%% then %%i:bottom:start%%b%%i:bottom:end%%\n";
    expect(foldAnnotations(store, markerRootIds(source)).map((thread) => thread.id)).toStrictEqual([
      "top",
      "bottom",
      "early",
      "late",
    ]);
  });

  it("leaves dangling and cyclic chains out of every thread", () => {
    const broken: AnnotationStore = {
      ...STORE,
      dangling: { createdAt: AT, parentId: "gone", text: "x", updatedAt: AT },
      loopA: { createdAt: AT, parentId: "loopB", text: "x", updatedAt: AT },
      loopB: { createdAt: AT, parentId: "loopA", text: "x", updatedAt: AT },
    };
    const threads = foldAnnotations(broken, new Set(["c1"]));
    expect(
      threads.flatMap((thread) => [thread.id, ...thread.replies.map(({ id }) => id)]),
    ).toStrictEqual(["c1", "c1-r1", "c1-r2", "b9"]);
  });

  it("reports every thread anchored while the body is not held", () => {
    expect(foldAnnotations(STORE, null).every((thread) => thread.anchored)).toBe(true);
  });
});

const webRandomBytes = (length: number): Uint8Array =>
  globalThis.crypto.getRandomValues(new Uint8Array(length));

describe(mintAnnotationId, () => {
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
    expect(markerRootIds(`The %%i:${id}:start%%plan%%i:${id}:end%% holds.\n`)).toStrictEqual(
      new Set([id]),
    );
  });

  it("parses a marker for every character the id alphabet admits", () => {
    const id = "Az09_-";
    expect(id).toMatch(ANNOTATION_ID_RE);
    expect(markerRootIds(`%%i:${id},b:start%%x%%i:${id},b:end%%\n`)).toStrictEqual(
      new Set([id, "b"]),
    );
  });
});
