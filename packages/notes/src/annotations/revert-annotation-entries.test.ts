import { describe, expect, it } from "vitest";
import { revertAnnotationEntries } from "./revert-entries";
import type { AnnotationEntriesRevertInput } from "./revert-entries";
import type { AnnotationEntry } from "./store-schema";

const AT = 1_707_900_000;

const entry = (text: string, fields: Partial<AnnotationEntry> = {}): AnnotationEntry => ({
  createdAt: AT,
  source: "user",
  text,
  updatedAt: AT,
  ...fields,
});

const NO_MARKERS: ReadonlySet<string> = new Set();

const revert = (input: Partial<AnnotationEntriesRevertInput>) =>
  revertAnnotationEntries({
    after: {},
    before: {},
    current: {},
    markerIds: NO_MARKERS,
    ...input,
  });

describe(revertAnnotationEntries, () => {
  const mine = entry("Why Friday?");
  const agents = entry("Consider Thursday", { source: "agent" });

  it("removes an entry the change added", () => {
    expect(revert({ after: { a1: agents }, current: { a1: agents } })).toStrictEqual({
      kept: false,
      kind: "reverted",
      store: {},
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
    ).toStrictEqual({ kept: false, kind: "reverted", store: { c1: mine, u1: later } });
  });

  it("keeps an entry the change added once someone answered it, with the answer", () => {
    const answer = entry("No, Friday", { parentId: "a1" });
    expect(revert({ after: { a1: agents }, current: { a1: agents, u1: answer } })).toStrictEqual({
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
    ).toStrictEqual({ kept: true, kind: "reverted", store: { a1: agents, u1: answer } });
  });

  it("keeps an entry the change added while a marker still anchors it", () => {
    expect(
      revert({ after: { a1: agents }, current: { a1: agents }, markerIds: new Set(["a1"]) }),
    ).toStrictEqual({ kept: true, kind: "unchanged" });
  });

  it("keeps an entry the change added and someone edited since", () => {
    const edited = entry("Consider Thursday, or Monday", {
      source: "user",
      updatedAt: AT + 5,
    });
    expect(revert({ after: { a1: agents }, current: { a1: edited } })).toStrictEqual({
      kept: true,
      kind: "unchanged",
    });
  });

  it("leaves an entry the change added and someone deleted since gone", () => {
    expect(revert({ after: { a1: agents }, current: {} })).toStrictEqual({
      kept: false,
      kind: "unchanged",
    });
  });

  it("restores a thread whose notes the change rewrote to what they said", () => {
    const reply = entry("Because of the demo", { createdAt: AT + 1, parentId: "c1" });
    const rewrote: Partial<AnnotationEntry> = { source: "agent", updatedAt: AT + 30 };
    const rewritten = {
      c1: { ...mine, ...rewrote, text: "Friday it is." },
      r1: { ...reply, ...rewrote, text: "The demo moved." },
    };
    expect(
      revert({ after: rewritten, before: { c1: mine, r1: reply }, current: rewritten }),
    ).toStrictEqual({ kept: false, kind: "reverted", store: { c1: mine, r1: reply } });
  });

  it("keeps a rewrite someone edited again since", () => {
    const rewritten = entry("Friday it is.", { source: "agent", updatedAt: AT + 30 });
    const editedAgain = entry("Friday, unless the demo moves.", { updatedAt: AT + 40 });
    expect(
      revert({ after: { c1: rewritten }, before: { c1: mine }, current: { c1: editedAgain } }),
    ).toStrictEqual({ kept: true, kind: "unchanged" });
  });

  it("brings back a thread the change deleted, after what is there now", () => {
    const reply = entry("Because of the demo", { parentId: "c1" });
    const later = entry("Mine, since");
    const back = revert({ after: {}, before: { c1: mine, r1: reply }, current: { u1: later } });
    expect(back).toStrictEqual({
      kept: false,
      kind: "reverted",
      store: { c1: mine, r1: reply, u1: later },
    });
    expect(back.kind === "reverted" && Object.keys(back.store)).toStrictEqual(["u1", "c1", "r1"]);
    expect(revert({ before: { c1: mine } })).toStrictEqual({
      kept: false,
      kind: "reverted",
      store: { c1: mine },
    });
  });

  it("leaves a reply the change deleted gone once its thread is", () => {
    const reply = entry("Because of the demo", { parentId: "c1" });
    expect(
      revert({ after: { c1: mine }, before: { c1: mine, r1: reply }, current: {} }),
    ).toStrictEqual({
      kept: true,
      kind: "unchanged",
    });
  });
});
