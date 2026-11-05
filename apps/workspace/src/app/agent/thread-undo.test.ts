import { describe, expect, it } from "vitest";

import { conversationUndo, turnUndo } from "./thread-undo";

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
    expect(turnUndo(sets, 1)).toEqual(["a"]);
    expect(turnUndo(sets, 3)).toBeNull();
  });

  it("takes back every set the conversation made, newest first, less the undone and the open", () => {
    const sets = [
      set("d", 4, { closedAt: null }),
      set("c", 3),
      set("b", 2, { undoneBy: "x" }),
      set("a", 1),
    ];
    expect(conversationUndo(sets)).toEqual(["c", "a"]);
    expect(conversationUndo([set("b", 2, { undoneBy: "x" })])).toBeNull();
  });
});
