// @vitest-environment jsdom
// What a streaming token costs the rendered timeline. Every provider event
// produces a delta, and `applyTimelineDelta` deliberately preserves the object
// identity of every row it did not touch — so a row that re-renders anyway is
// throwing that away, and a turn row carries its whole subtree.

import type { TimelineRow, TimelineTurnRow } from "@repo/server-contract/thread-timeline";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TimelineRowView } from "../timeline-rows";

const { spinnerRenders } = vi.hoisted(() => ({ spinnerRenders: { count: 0 } }));

// The one leaf inside a pending turn's subtree, counted: it renders exactly
// when its turn row does.
vi.mock("@repo/ui/components/spinner", () => ({
  Spinner: () => {
    spinnerRenders.count += 1;
    return <span data-testid="spinner" />;
  },
}));

afterEach(() => {
  cleanup();
  spinnerRenders.count = 0;
});

const base = { threadId: "thr_1", createdAt: 1_000 };

const assistant = (text: string, seq: number): TimelineRow => ({
  ...base,
  kind: "conversation",
  role: "assistant",
  id: "item:turn_1:item_a",
  turnId: "turn_1",
  text,
  viewContext: null,
  sourceSeqStart: 5,
  sourceSeqEnd: seq,
});

const pendingTurn: TimelineTurnRow = {
  ...base,
  kind: "turn",
  id: "turn:turn_1",
  turnId: "turn_1",
  status: "pending",
  completedAt: null,
  children: [
    {
      ...base,
      kind: "work",
      workKind: "reasoning",
      id: "item:turn_1:item_r",
      turnId: "turn_1",
      status: "completed",
      text: "Scanning the vault…",
      sourceSeqStart: 3,
      sourceSeqEnd: 4,
    },
  ],
  sourceSeqStart: 2,
  sourceSeqEnd: 4,
};

const List = ({ rows }: { rows: readonly TimelineRow[] }) => (
  <div>
    {rows.map((row) => (
      <TimelineRowView key={row.id} row={row} />
    ))}
  </div>
);

it("re-renders only the row a delta actually replaced", () => {
  const view = render(<List rows={[assistant("Two commits ", 6), pendingTurn]} />);
  expect(spinnerRenders.count).toBe(1);

  // Exactly what applyTimelineDelta yields for one more token: a new object
  // for the streamed row, the SAME object for everything else.
  view.rerender(<List rows={[assistant("Two commits landed today.", 7), pendingTurn]} />);

  expect(spinnerRenders.count).toBe(1);
  expect(view.container.textContent).toContain("Two commits landed today.");
});
