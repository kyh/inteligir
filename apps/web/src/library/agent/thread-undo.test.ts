import { describe, expect, it } from "vitest";

import { BULK_ITEMS_MAX } from "@repo/contract/library/library-wire";

import { changeSetsOf, conversationUndo, turnUndo, undoBatches } from "./thread-undo";

const THREAD = "0199a4c2-0000-7000-8000-00000000000a";

const set = (
  id: string,
  turn: number,
  more: { undoneBy?: string; closedAt?: string | null } = {},
) => ({
  actor: "agent" as const,
  closedAt: more.closedAt === undefined ? "2026-11-05T10:00:00.000Z" : more.closedAt,
  id,
  itemCount: 1,
  items: [],
  label: "Agent",
  openedAt: "2026-11-05T09:59:00.000Z",
  threadId: THREAD,
  turn,
  undoneBy: more.undoneBy ?? null,
});

describe("an agent conversation's undo", () => {
  it("takes back one turn's set, and nothing for a turn that changed nothing", () => {
    const sets = [set("b", 2), set("a", 1)];
    expect(turnUndo(sets, 1)).toStrictEqual(["a"]);
    expect(turnUndo(sets, 3)).toBeNull();
  });

  it("takes back every set the conversation made, newest first, less the undone and the open", () => {
    const sets = [
      set("d", 4, { closedAt: null }),
      set("c", 3),
      set("b", 2, { undoneBy: "x" }),
      set("a", 1),
    ];
    expect(conversationUndo(sets)).toStrictEqual(["c", "a"]);
    expect(conversationUndo([set("b", 2, { undoneBy: "x" })])).toBeNull();
  });
});

describe("a conversation longer than one page of change sets", () => {
  it("is undone from every page, each set once, in as few undos as the cell takes", () => {
    // three pages as the cell answers them, newest first; a set made after the first page was
    // asked moved the second page's first set onto it again
    const turns = Array.from({ length: BULK_ITEMS_MAX + 20 }, (_, at) => BULK_ITEMS_MAX + 20 - at);
    const sets = turns.map((turn) => set(`s${String(turn)}`, turn));
    const pages = [
      { changeSets: sets.slice(0, 50) },
      { changeSets: sets.slice(49, 100) },
      { changeSets: sets.slice(100) },
    ];
    const listed = changeSetsOf(pages);
    expect(listed.map((one) => one.id)).toStrictEqual(sets.map((one) => one.id));
    expect(turnUndo(listed, 1)).toStrictEqual(["s1"]);
    const whole = conversationUndo(listed) ?? [];
    const batches = undoBatches(whole);
    expect(batches.map((batch) => batch.length)).toStrictEqual([BULK_ITEMS_MAX, 20]);
    expect(batches.flat()).toStrictEqual(whole);
    expect(batches[0]?.[0]).toBe(`s${String(BULK_ITEMS_MAX + 20)}`);
  });
});
