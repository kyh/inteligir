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
import { parseSidecar, serializeSidecar, type CommentSidecar } from "../sidecar-schema";

const AT = 1_707_900_000;

const SIDECAR: CommentSidecar = {
  c1: { text: "Should this ship?", createdAt: AT, updatedAt: AT, source: "user" },
  "c1-r1": {
    text: "Reflected in the plan.",
    createdAt: AT + 100,
    updatedAt: AT + 100,
    source: "external",
    parentId: "c1",
  },
  "c1-r2": {
    text: "Nested follow-up.",
    createdAt: AT + 200,
    updatedAt: AT + 200,
    source: "agent",
    parentId: "c1-r1",
  },
  b9: { text: "Unanchored root.", createdAt: AT, updatedAt: AT, source: "user" },
};

describe("sidecar schema", () => {
  it("round-trips unknown fields and insertion order", () => {
    const raw = `${JSON.stringify(
      {
        z: { text: "t", createdAt: AT, updatedAt: AT, mossOnly: { deep: true } },
        a: { text: "u", createdAt: AT, updatedAt: AT, imageUrl: "assets/legacy.png" },
      },
      null,
      2,
    )}\n`;
    const parsed = parseSidecar(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializeSidecar(parsed.sidecar)).toBe(raw);
  });

  it("surfaces malformed bytes instead of folding to empty", () => {
    expect(parseSidecar("{not json").ok).toBe(false);
    expect(parseSidecar('{"x": {"text": "missing timestamps"}}').ok).toBe(false);
  });

  it("refuses an id outside the marker alphabet", () => {
    const parsed = parseSidecar(
      JSON.stringify({ "bad id": { text: "t", createdAt: AT, updatedAt: AT } }),
    );
    expect(parsed.ok).toBe(false);
  });
});

describe("markerRootIds", () => {
  it("collects comma-shared ids and ignores fences", () => {
    const source = [
      "A %%m:c1:start%%range%%m:c1:end%% and %%m:a,b:start%%shared%%m:a,b:end%%.",
      "",
      "```",
      "%%m:fenced:start%% literal %%m:fenced:end%%",
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
    const c1 = folded.threads[0];
    expect(c1?.replies.map((reply) => reply.id)).toEqual(["c1-r1", "c1-r2"]);
    expect(c1?.anchored).toBe(true);
    expect(folded.threads[1]?.anchored).toBe(false);
    expect(folded.orphanMarkers).toEqual(["ghost"]);
    expect(folded.strayIds).toEqual([]);
  });

  it("surfaces dangling and cyclic chains as strays", () => {
    const broken: CommentSidecar = {
      ...SIDECAR,
      dangling: { text: "x", createdAt: AT, updatedAt: AT, parentId: "gone" },
      loopA: { text: "x", createdAt: AT, updatedAt: AT, parentId: "loopB" },
      loopB: { text: "x", createdAt: AT, updatedAt: AT, parentId: "loopA" },
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
    expect(addRoot(SIDECAR, { id: "c1", text: "x", source: "user", at: AT }).ok).toBe(false);
    const added = addRoot(SIDECAR, { id: "n1", text: "x", source: "user", at: AT + 5 });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(Object.keys(added.sidecar).at(-1)).toBe("n1");
    expect(SIDECAR["n1"]).toBeUndefined();
  });

  it("addReply requires a parent reachable from a root", () => {
    expect(
      addReply(SIDECAR, { id: "r9", parentId: "missing", text: "x", source: "agent", at: AT }).ok,
    ).toBe(false);
    const nested = addReply(SIDECAR, {
      id: "r9",
      parentId: "c1-r2",
      text: "x",
      source: "agent",
      at: AT,
    });
    expect(nested.ok).toBe(true);
  });

  it("resolveThread stamps the root and every descendant, and reopen strips both fields", () => {
    const resolved = resolveThread(SIDECAR, {
      rootId: "c1",
      resolved: true,
      by: "agent",
      at: AT + 9,
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    for (const id of ["c1", "c1-r1", "c1-r2"]) {
      expect(resolved.sidecar[id]?.resolvedAt).toBe(AT + 9);
      expect(resolved.sidecar[id]?.resolvedBy).toBe("agent");
      expect(resolved.sidecar[id]?.updatedAt).toBe(AT + 9);
    }
    expect(resolved.sidecar["b9"]?.resolvedAt).toBeUndefined();
    const reopened = resolveThread(resolved.sidecar, {
      rootId: "c1",
      resolved: false,
      by: "user",
      at: AT + 10,
    });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.sidecar["c1"]?.resolvedAt).toBeUndefined();
    expect(reopened.sidecar["c1"]?.resolvedBy).toBeUndefined();
  });

  it("resolveThread refuses a reply id", () => {
    expect(resolveThread(SIDECAR, { rootId: "c1-r1", resolved: true, by: "user", at: AT }).ok).toBe(
      false,
    );
  });

  it("deleteThread removes the whole chain and answers which ids died", () => {
    const deleted = deleteThread(SIDECAR, "c1");
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.removedIds.toSorted()).toEqual(["c1", "c1-r1", "c1-r2"]);
    expect(Object.keys(deleted.sidecar)).toEqual(["b9"]);
    expect(threadIds(SIDECAR, "c1").toSorted()).toEqual(["c1", "c1-r1", "c1-r2"]);
  });
});
