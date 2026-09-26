import { describe, expect, it } from "vitest";
import { revertCommentEntries } from "../revert-entries";
import type { CommentEntriesRevertInput } from "../revert-entries";
import type { CommentEntry } from "../sidecar-schema";

const AT = 1_707_900_000;

const entry = (text: string, fields: Partial<CommentEntry> = {}): CommentEntry => ({
  createdAt: AT,
  source: "user",
  text,
  updatedAt: AT,
  ...fields,
});

const NO_MARKERS: ReadonlySet<string> = new Set();

const revert = (input: Partial<CommentEntriesRevertInput>) =>
  revertCommentEntries({
    after: null,
    before: null,
    current: null,
    markerIds: NO_MARKERS,
    ...input,
  });

describe("revertCommentEntries", () => {
  const mine = entry("Why Friday?");
  const agents = entry("Consider Thursday", { source: "agent" });

  it("removes an entry the change added, and a store left empty goes", () => {
    expect(revert({ after: { a1: agents }, current: { a1: agents } })).toEqual({
      kept: false,
      kind: "reverted",
      sidecar: null,
    });
  });

  it("removes the change's own reply with the root it answers, and keeps what came since", () => {
    const reply = entry("And Monday", { parentId: "a1", source: "agent" });
    const later = entry("A thread of my own", { createdAt: AT + 60, updatedAt: AT + 60 });
    expect(
      revert({
        after: { a1: agents, a2: reply, c1: mine },
        before: { c1: mine },
        current: { a1: agents, a2: reply, c1: mine, u1: later },
      }),
    ).toEqual({ kept: false, kind: "reverted", sidecar: { c1: mine, u1: later } });
  });

  it("keeps an entry the change added once someone answered it, with the answer", () => {
    const answer = entry("No, Friday", { parentId: "a1" });
    expect(revert({ after: { a1: agents }, current: { a1: agents, u1: answer } })).toEqual({
      kept: true,
      kind: "unchanged",
    });
  });

  it("removes only the entries nobody answered", () => {
    const other = entry("Also this", { source: "agent" });
    const answer = entry("No, Friday", { parentId: "a1" });
    expect(
      revert({
        after: { a1: agents, a2: other },
        current: { a1: agents, a2: other, u1: answer },
      }),
    ).toEqual({ kept: true, kind: "reverted", sidecar: { a1: agents, u1: answer } });
  });

  it("keeps an entry the change added while a marker still anchors it, or none can be read", () => {
    expect(
      revert({ after: { a1: agents }, current: { a1: agents }, markerIds: new Set(["a1"]) }),
    ).toEqual({ kept: true, kind: "unchanged" });
    expect(revert({ after: { a1: agents }, current: { a1: agents }, markerIds: null })).toEqual({
      kept: true,
      kind: "unchanged",
    });
  });

  it("keeps an entry the change added and someone edited since", () => {
    const resolved = entry("Consider Thursday", {
      resolvedAt: AT + 5,
      resolvedBy: "user",
      source: "agent",
    });
    expect(revert({ after: { a1: agents }, current: { a1: resolved } })).toEqual({
      kept: true,
      kind: "unchanged",
    });
  });

  it("leaves an entry the change added and someone deleted since gone", () => {
    expect(revert({ after: { a1: agents }, current: {} })).toEqual({
      kept: false,
      kind: "unchanged",
    });
  });

  it("restores a thread the change resolved to unresolved", () => {
    const reply = entry("Because of the demo", { createdAt: AT + 1, parentId: "c1" });
    const resolvedAt: Partial<CommentEntry> = {
      resolvedAt: AT + 30,
      resolvedBy: "agent",
      updatedAt: AT + 30,
    };
    const resolved = { c1: { ...mine, ...resolvedAt }, r1: { ...reply, ...resolvedAt } };
    expect(revert({ after: resolved, before: { c1: mine, r1: reply }, current: resolved })).toEqual(
      { kept: false, kind: "reverted", sidecar: { c1: mine, r1: reply } },
    );
  });

  it("keeps a resolve someone undid since", () => {
    const resolved = entry("Why Friday?", { resolvedAt: AT + 30, resolvedBy: "agent" });
    const reopened = entry("Why Friday?", { updatedAt: AT + 40 });
    expect(
      revert({ after: { c1: resolved }, before: { c1: mine }, current: { c1: reopened } }),
    ).toEqual({ kept: true, kind: "unchanged" });
  });

  it("brings back a thread the change deleted, after what is there now", () => {
    const reply = entry("Because of the demo", { parentId: "c1" });
    const later = entry("Mine, since");
    const back = revert({ after: {}, before: { c1: mine, r1: reply }, current: { u1: later } });
    expect(back).toEqual({
      kept: false,
      kind: "reverted",
      sidecar: { c1: mine, r1: reply, u1: later },
    });
    expect(back.kind === "reverted" && Object.keys(back.sidecar ?? {})).toEqual(["u1", "c1", "r1"]);
    expect(revert({ after: null, before: { c1: mine }, current: null })).toEqual({
      kept: false,
      kind: "reverted",
      sidecar: { c1: mine },
    });
  });

  it("leaves a reply the change deleted gone once its thread is", () => {
    const reply = entry("Because of the demo", { parentId: "c1" });
    expect(revert({ after: { c1: mine }, before: { c1: mine, r1: reply }, current: {} })).toEqual({
      kept: true,
      kind: "unchanged",
    });
  });
});
