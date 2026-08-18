// @vitest-environment jsdom
// What a streaming token costs the rendered timeline. Every provider event
// produces a delta, and `applyTimelineDelta` deliberately preserves the object
// identity of every row it did not touch — so a row that re-renders anyway is
// throwing that away, and a turn row carries its whole subtree.

import type {
  TimelineConversationRow,
  TimelineRow,
  TimelineTurnRow,
} from "@repo/server-contract/thread-timeline";
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

const userMessage = (viewContext: TimelineConversationRow["viewContext"]): TimelineRow => ({
  ...base,
  kind: "conversation",
  role: "user",
  id: "user:1",
  turnId: null,
  text: "make this shorter",
  viewContext,
  sourceSeqStart: 1,
  sourceSeqEnd: 1,
});

it("attributes a user message to what the sender was looking at", () => {
  const view = render(
    <List
      rows={[
        userMessage({
          surface: "doc",
          resource: "Notes/Plans.md",
          revision: "a".repeat(64),
          selection: { from: 12, to: 41, text: "First paragraph.\nAnd a second." },
        }),
      ]}
    />,
  );

  // The bubble is what was typed; the file and the selection's first line ride
  // beneath it, so the user can see what the agent was told.
  expect(view.container.textContent).toContain("make this shorter");
  expect(view.container.textContent).toContain("Notes/Plans.md");
  expect(view.container.textContent).toContain("First paragraph.");
  // Never the revision, and never the rest of a multi-line selection.
  expect(view.container.textContent).not.toContain("a".repeat(64));
  expect(view.container.textContent).not.toContain("And a second.");
});

it("renders a message with no context as the bubble alone", () => {
  const view = render(<List rows={[userMessage(null)]} />);
  expect(view.container.textContent).toBe("make this shorter");
});
