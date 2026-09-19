import { describe, expect, it } from "vitest";

import {
  addReply,
  addRoot,
  deleteThread,
  foldThreads,
  resolveThread,
  rootOf,
  threadIds,
} from "../comment-threads";
import { markerRootIds } from "../marker-ids";
import { COMMENT_ID_RE, mintCommentId, parseSidecar, serializeSidecar } from "../sidecar-schema";
import type { CommentSidecar } from "../sidecar-schema";

const AT = 1_707_900_000;

/* oxlint-disable sort-keys -- a sidecar's insertion order IS its thread order, which these tests assert */
const SIDECAR: CommentSidecar = {
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
/* oxlint-enable sort-keys */

describe("sidecar schema", () => {
  it("round-trips unknown fields and insertion order", () => {
    // oxlint-disable sort-keys -- the fixture is the assertion: an unsorted root pair and a
    // foreign field after the known ones is exactly what a round-trip has to give back.
    const raw = `${JSON.stringify(
      {
        z: { text: "t", createdAt: AT, updatedAt: AT, foreignOnly: { deep: true } },
        a: { text: "u", createdAt: AT, updatedAt: AT, imageUrl: "assets/legacy.png" },
      },
      null,
      2,
    )}\n`;
    // oxlint-enable sort-keys
    const parsed = parseSidecar(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(serializeSidecar(parsed.sidecar)).toBe(raw);
  });

  it("surfaces malformed bytes instead of folding to empty", () => {
    expect(parseSidecar("{not json").ok).toBe(false);
    expect(parseSidecar('{"x": {"text": "missing timestamps"}}').ok).toBe(false);
  });

  it("refuses an id outside the marker alphabet", () => {
    const parsed = parseSidecar(
      JSON.stringify({ "bad id": { createdAt: AT, text: "t", updatedAt: AT } }),
    );
    expect(parsed.ok).toBe(false);
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

  it("answers null for an unparseable doc rather than claiming none", () => {
    expect(markerRootIds("<Foo>broken</Bar>\n")).toBeNull();
  });
});

describe("foldThreads", () => {
  it("builds threads with replies in parent-chain order and flags both orphan directions", () => {
    const folded = foldThreads(SIDECAR, new Set(["c1", "ghost"]));
    expect(folded.threads.map((thread) => thread.rootId)).toEqual(["c1", "b9"]);
    const [c1] = folded.threads;
    expect(c1?.replies.map((reply) => reply.id)).toEqual(["c1-r1", "c1-r2"]);
    expect(c1?.anchored).toBe(true);
    expect(folded.threads[1]?.anchored).toBe(false);
    expect(folded.orphanMarkers).toEqual(["ghost"]);
    expect(folded.strayIds).toEqual([]);
  });

  it("surfaces dangling and cyclic chains as strays", () => {
    const broken: CommentSidecar = {
      ...SIDECAR,
      dangling: { createdAt: AT, parentId: "gone", text: "x", updatedAt: AT },
      loopA: { createdAt: AT, parentId: "loopB", text: "x", updatedAt: AT },
      loopB: { createdAt: AT, parentId: "loopA", text: "x", updatedAt: AT },
    };
    const folded = foldThreads(broken, new Set(["c1"]));
    expect(folded.strayIds.toSorted()).toEqual(["dangling", "loopA", "loopB"]);
    expect(rootOf(broken, "loopA")).toBeNull();
    expect(rootOf(broken, "dangling")).toBeNull();
  });

  it("claims nothing about markers when the doc was unparseable", () => {
    const folded = foldThreads(SIDECAR, null);
    expect(folded.orphanMarkers).toEqual([]);
    expect(folded.threads.every((thread) => thread.anchored)).toBe(true);
  });
});

describe("transforms", () => {
  it("addRoot refuses a taken id and appends in insertion order", () => {
    expect(addRoot(SIDECAR, { at: AT, id: "c1", source: "user", text: "x" }).ok).toBe(false);
    const added = addRoot(SIDECAR, { at: AT + 5, id: "n1", source: "user", text: "x" });
    expect(added.ok).toBe(true);
    if (!added.ok) {
      return;
    }
    expect(Object.keys(added.sidecar).at(-1)).toBe("n1");
    expect(SIDECAR.n1).toBeUndefined();
  });

  it("addReply requires a parent reachable from a root", () => {
    expect(
      addReply(SIDECAR, { at: AT, id: "r9", parentId: "missing", source: "agent", text: "x" }).ok,
    ).toBe(false);
    const nested = addReply(SIDECAR, {
      at: AT,
      id: "r9",
      parentId: "c1-r2",
      source: "agent",
      text: "x",
    });
    expect(nested.ok).toBe(true);
  });

  it("resolveThread stamps the root and every descendant, and reopen strips both fields", () => {
    const resolved = resolveThread(SIDECAR, {
      at: AT + 9,
      by: "agent",
      resolved: true,
      rootId: "c1",
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    for (const id of ["c1", "c1-r1", "c1-r2"]) {
      expect(resolved.sidecar[id]?.resolvedAt).toBe(AT + 9);
      expect(resolved.sidecar[id]?.resolvedBy).toBe("agent");
      expect(resolved.sidecar[id]?.updatedAt).toBe(AT + 9);
    }
    expect(resolved.sidecar.b9?.resolvedAt).toBeUndefined();
    const reopened = resolveThread(resolved.sidecar, {
      at: AT + 10,
      by: "user",
      resolved: false,
      rootId: "c1",
    });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) {
      return;
    }
    expect(reopened.sidecar.c1?.resolvedAt).toBeUndefined();
    expect(reopened.sidecar.c1?.resolvedBy).toBeUndefined();
  });

  it("resolveThread refuses a reply id", () => {
    expect(resolveThread(SIDECAR, { at: AT, by: "user", resolved: true, rootId: "c1-r1" }).ok).toBe(
      false,
    );
  });

  it("deleteThread removes the whole chain and answers which ids died", () => {
    const deleted = deleteThread(SIDECAR, "c1");
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) {
      return;
    }
    expect(deleted.removedIds.toSorted()).toEqual(["c1", "c1-r1", "c1-r2"]);
    expect(Object.keys(deleted.sidecar)).toEqual(["b9"]);
    expect(threadIds(SIDECAR, "c1").toSorted()).toEqual(["c1", "c1-r1", "c1-r2"]);
  });
});

describe("mintCommentId", () => {
  it("mints ids the marker grammar accepts, from the lowercase alphabet", () => {
    const minted = Array.from({ length: 50 }, () => mintCommentId());
    for (const id of minted) {
      expect(id).toMatch(/^[a-z0-9]{10}$/u);
      expect(id).toMatch(COMMENT_ID_RE);
    }
    expect(new Set(minted).size).toBe(minted.length);
  });
});
