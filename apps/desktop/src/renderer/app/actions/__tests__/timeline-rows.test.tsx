// @vitest-environment jsdom

import type {
  TimelineCommandWorkRow,
  TimelineConversationRow,
  TimelineRow,
  TimelineTurnRow,
} from "@repo/api/local/thread-timeline";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { TimelineRowView } from "../timeline-rows";

afterEach(cleanup);

// counts renders through a getter the view reads once per render, and a bailed-out memo reads nothing.
interface CountedRow<Row extends TimelineRow> {
  row: Row;
  renders: () => number;
}

const counted = <Row extends TimelineRow>(row: Row, field: keyof Row & string): CountedRow<Row> => {
  let renders = 0;
  const value = row[field];
  const counting = Object.defineProperty({ ...row }, field, {
    enumerable: true,
    get: () => {
      renders += 1;
      return value;
    },
  });
  return { renders: () => renders, row: counting };
};

const base = { createdAt: 1000, threadId: "thr_1" };

const assistant = (text: string, seq: number): TimelineRow => ({
  ...base,
  id: "item:turn_1:item_a",
  kind: "conversation",
  role: "assistant",
  sourceSeqEnd: seq,
  sourceSeqStart: 5,
  text,
  turnId: "turn_1",
  viewContext: null,
});

const pendingTurn: TimelineTurnRow = {
  ...base,
  children: [
    {
      ...base,
      id: "item:turn_1:item_r",
      kind: "work",
      sourceSeqEnd: 4,
      sourceSeqStart: 3,
      status: "completed",
      text: "Scanning the vault…",
      turnId: "turn_1",
      workKind: "reasoning",
    },
  ],
  completedAt: null,
  id: "turn:turn_1",
  kind: "turn",
  sourceSeqEnd: 4,
  sourceSeqStart: 2,
  status: "pending",
  turnId: "turn_1",
};

const List = ({ rows }: { rows: readonly TimelineRow[] }) => (
  <div>
    {rows.map((row) => (
      <TimelineRowView key={row.id} row={row} />
    ))}
  </div>
);

it("re-renders only the row a delta actually replaced", () => {
  const streamed = counted(assistant("Two commits ", 6), "kind");
  const turn = counted(pendingTurn, "kind");
  const view = render(<List rows={[streamed.row, turn.row]} />);
  expect(streamed.renders()).toBe(1);
  expect(turn.renders()).toBe(1);

  const restreamed = counted(assistant("Two commits landed today.", 7), "kind");
  view.rerender(<List rows={[restreamed.row, turn.row]} />);

  expect(restreamed.renders()).toBe(1);
  expect(turn.renders()).toBe(1);
  expect(view.container.textContent).toContain("Two commits landed today.");
});

const commandRun = (
  name: string,
  seq: number,
  output: { head: string[]; lines: number },
): TimelineCommandWorkRow => ({
  ...base,
  approvalStatus: null,
  command: `make ${name}`,
  cwd: "/vault",
  exitCode: 0,
  id: `item:turn_1:${name}`,
  kind: "work",
  outputHead: output.head,
  outputLineCount: output.lines,
  sourceSeqEnd: seq,
  sourceSeqStart: seq,
  status: "completed",
  turnId: "turn_1",
  workKind: "command",
});

// `command` is read by the chip alone, so it counts the chip's renders and not the turn's. the
// compiler reads a dependency more than once per render, so only "read again or not" is asserted.
it("re-renders only the chip a turn patch replaced", () => {
  const settled = counted(commandRun("build", 5, { head: ["built"], lines: 1 }), "command");
  const running = counted(commandRun("test", 6, { head: [], lines: 0 }), "command");
  const view = render(<List rows={[{ ...pendingTurn, children: [settled.row, running.row] }]} />);
  const settledRenders = settled.renders();
  expect(settledRenders).toBeGreaterThan(0);

  const ran = counted(commandRun("test", 7, { head: ["passed"], lines: 1 }), "command");
  view.rerender(
    <List rows={[{ ...pendingTurn, children: [settled.row, ran.row], sourceSeqEnd: 7 }]} />,
  );

  expect(settled.renders()).toBe(settledRenders);
  expect(ran.renders()).toBeGreaterThan(0);
  expect(view.container.textContent).toContain("passed");
});

it("names the lines a command's head leaves out", () => {
  const head = Array.from({ length: 40 }, (_, line) => `line ${String(line)}`);
  const view = render(
    <List
      rows={[
        {
          ...pendingTurn,
          children: [commandRun("build", 5, { head, lines: 10_000 })],
        },
      ]}
    />,
  );
  expect(view.container.textContent).toContain("line 39");
  expect(view.container.textContent).toContain("9960 more lines");
});

const userMessage = (viewContext: TimelineConversationRow["viewContext"]): TimelineRow => ({
  ...base,
  id: "user:1",
  kind: "conversation",
  role: "user",
  sourceSeqEnd: 1,
  sourceSeqStart: 1,
  text: "make this shorter",
  turnId: null,
  viewContext,
});

it("attributes a user message to what the sender was looking at", () => {
  const view = render(
    <List
      rows={[
        userMessage({
          resource: "Notes/Plans.md",
          revision: "a".repeat(64),
          surface: "doc",
        }),
      ]}
    />,
  );

  expect(view.container.textContent).toContain("make this shorter");
  expect(view.container.textContent).toContain("Notes/Plans.md");
  expect(view.container.textContent).not.toContain("a".repeat(64));
});

it("renders a message with no context as the bubble alone", () => {
  const view = render(<List rows={[userMessage(null)]} />);
  expect(view.container.textContent).toBe("make this shorter");
});
