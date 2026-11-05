// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakePageLibrary, renderOnLibrary } from "../test-support/fake-page-library";
import type { CellCall, ThreadEventRow, ThreadRow } from "../test-support/fake-page-library";
import { AgentPanel } from "./agent-panel";
import { TIDY_LABEL, TIDY_VIEW_CONTEXT, tidyMessage } from "@repo/agent-panel/tidy-library";

afterEach(cleanup);

const THREAD = "0199a4c2-0000-7000-8000-00000000000a";
const AT = 1_793_000_000_000;

const thread: ThreadRow = {
  createdAt: AT,
  id: THREAD,
  seq: 1,
  status: "idle",
  title: "Tidying",
  updatedAt: AT,
};

const row = (idx: number, event: ThreadEventRow["event"]): ThreadEventRow => ({
  at: AT + idx,
  event,
  eventId: `e${String(idx)}`,
  idx,
  seq: idx + 1,
  threadId: THREAD,
  type: "event",
});

const set = (id: string, turn: number) => ({
  actor: "agent",
  closedAt: "2026-11-05T10:00:00.000Z",
  id,
  itemCount: 1,
  items: [],
  label: "Agent",
  openedAt: "2026-11-05T09:59:00.000Z",
  threadId: THREAD,
  turn,
  undoneBy: null,
});

const panel = (flushOpen = vi.fn(async () => await Promise.resolve())) => (
  <AgentPanel
    threadId={THREAD}
    onThread={vi.fn<(threadId: string | null) => void>()}
    viewContext={() => {}}
    flushOpen={flushOpen}
    tidying={false}
    onTidyEnd={vi.fn<() => void>()}
  />
);

const callsTo = (calls: readonly CellCall[], path: string): unknown[] =>
  calls.filter((call) => call.path === path).map((call) => call.input);

describe("the agent panel's conversation", () => {
  it("answers an approval by the event that asked it", async () => {
    const { calls, library } = fakePageLibrary({
      answer: ({ path }) =>
        path === "library.history.list"
          ? { changeSets: [], cursor: null }
          : { status: "running", threadId: THREAD },
      events: [
        row(0, { text: "Bin the draft.", type: "user.message" }),
        row(1, {
          input: { ids: ["x"] },
          name: "delete_items",
          toolUseId: "toolu_1",
          type: "approval.asked",
          until: AT + 600_000,
        }),
      ],
      threads: [{ ...thread, status: "awaiting_approval" }],
    });
    renderOnLibrary(panel(), library);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => {
      expect(callsTo(calls, "library.agent.respond")).toEqual([
        { eventId: "e1", result: "allow", threadId: THREAD },
      ]);
    });
  });

  it("undoes a turn's set once the open item is written, and the conversation from every page", async () => {
    const flushOpen = vi.fn(async () => await Promise.resolve());
    const { calls, library } = fakePageLibrary({
      // the conversation's sets come over two pages, the second asked once the first is in
      answer: ({ path, input }) => {
        if (path === "library.history.list") {
          return JSON.stringify(input).includes('"cursor":"1"')
            ? { changeSets: [set("s1", 1)], cursor: null }
            : { changeSets: [set("s2", 2)], cursor: "1" };
        }
        return { changeSetId: "u1", kept: [], reverted: [] };
      },
      events: [
        row(0, { text: "File these.", type: "user.message" }),
        row(1, { reason: "done", turn: 1, type: "turn.ended" }),
        row(2, { text: "And these.", type: "user.message" }),
        row(3, { reason: "done", turn: 2, type: "turn.ended" }),
      ],
      threads: [thread],
    });
    renderOnLibrary(panel(flushOpen), library);
    // both turns offer their undo only once the older page, holding turn 1's set, is read
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Undo this turn" })).toHaveLength(2);
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Undo this turn" })[0] ?? document.body);
    await waitFor(() => {
      expect(callsTo(calls, "library.history.undo")).toEqual([{ changeSetIds: ["s1"] }]);
    });
    expect(flushOpen).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Undo this conversation" }));
    await waitFor(() => {
      expect(callsTo(calls, "library.history.undo")).toEqual([
        { changeSetIds: ["s1"] },
        { changeSetIds: ["s2", "s1"] },
      ]);
    });
  });

  it("sends Tidy my library from Unsorted, with nothing typed, and lets the request go once sent", async () => {
    const onThread = vi.fn<(threadId: string | null) => void>();
    const onTidyEnd = vi.fn<() => void>();
    const { calls, library } = fakePageLibrary({
      answer: () => ({ status: "running", threadId: THREAD }),
    });
    renderOnLibrary(
      <AgentPanel
        threadId={null}
        onThread={onThread}
        viewContext={() => ({ itemId: THREAD, surface: "item" })}
        flushOpen={vi.fn(async () => await Promise.resolve())}
        tidying
        onTidyEnd={onTidyEnd}
      />,
      library,
    );
    expect(screen.getByText(TIDY_LABEL)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(onThread).toHaveBeenCalledWith(THREAD);
    });
    expect(callsTo(calls, "library.agent.send")).toEqual([
      { text: tidyMessage(""), viewContext: TIDY_VIEW_CONTEXT },
    ]);
    expect(onTidyEnd).toHaveBeenCalledOnce();
  });
});
