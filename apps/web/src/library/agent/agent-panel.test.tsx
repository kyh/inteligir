// @vitest-environment jsdom

import { setTimeout as delay } from "node:timers/promises";
import { createORPCErrorFromJson } from "@orpc/client";
import { BULK_ITEMS_MAX } from "@repo/contract/library/library-wire";
import { NEEDS_CONNECTION } from "@repo/contract/refusal-text";
import { createFakeCell } from "@repo/contract/test-support/fake-cell";
import { toast } from "@repo/ui/components/sonner";
import { onlineManager } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { PausedWrites } from "../cloud/needs-connection";
import { fakePageLibrary, renderOnLibrary } from "../test-support/fake-page-library";
import type { CellCall, ThreadEventRow, ThreadRow } from "../test-support/fake-page-library";
import { AgentPanel } from "./agent-panel";
import { TIDY_LABEL, TIDY_VIEW_CONTEXT, tidyMessage } from "@repo/agent-panel/tidy-library";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  onlineManager.setOnline(true);
});

const THREAD = "0199a4c2-0000-7000-8000-00000000000a";
const OTHER_THREAD = "0199a4c2-0000-7000-8000-00000000000b";
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

const set = (id: string, turn: number, undoneBy: string | null = null) => ({
  actor: "agent",
  closedAt: "2026-11-05T10:00:00.000Z",
  id,
  itemCount: 1,
  items: [],
  label: "Agent",
  openedAt: "2026-11-05T09:59:00.000Z",
  threadId: THREAD,
  turn,
  undoneBy,
});

const panel = (
  flushOpen = vi.fn<() => Promise<void>>(async () => {
    await Promise.resolve();
  }),
  threadId: string | null = THREAD,
) => (
  <AgentPanel
    threadId={threadId}
    onThread={vi.fn<(threadId: string | null) => void>()}
    viewContext={() => {}}
    flushOpen={flushOpen}
    tidying={false}
    onTidyEnd={vi.fn<() => void>()}
    passage={null}
    onPassageTaken={vi.fn<() => void>()}
  />
);

const callsTo = (calls: readonly CellCall[], path: string): unknown[] =>
  calls.filter((call) => call.path === path).map((call) => call.input);

const oneFinishedTurn = [
  row(0, { text: "File these.", type: "user.message" }),
  row(1, { reason: "done", turn: 1, type: "turn.ended" }),
];

const UNDONE = { changeSetId: "u1", kept: [], lostText: [], refused: [], reverted: ["i1"] };

const ALREADY_UNDONE = "That change was already undone.";

// the panel on THREAD, until "Move" takes it to `to`, and back
const Moving = ({ to }: { to: string | null }) => {
  const [open, setOpen] = useState<string | null>(THREAD);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen((now) => (now === THREAD ? to : THREAD));
        }}
      >
        Move
      </button>
      {panel(undefined, open)}
    </>
  );
};

const noticeUp = (): boolean =>
  toast.getToasts().some((shown) => "title" in shown && shown.title === NEEDS_CONNECTION);

const setOnline = (online: boolean): void => {
  act(() => {
    onlineManager.setOnline(online);
  });
};

// every wait a read that meets no answer sits out before it gives up
const READ_RETRIES_MS = 7000;

const passTime = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const twoFinishedTurns = [
  ...oneFinishedTurn,
  row(2, { text: "And these.", type: "user.message" }),
  row(3, { reason: "done", turn: 2, type: "turn.ended" }),
];

const undoInput = z.object({ changeSetIds: z.array(z.string()) });

// the cell's own rule, as cell-undo.ts keeps it: a set goes back once, an undo naming one already
// undone is refused whole, and with no connection a call meets no answer. `hold` keeps a call from
// being answered until the suite says
const takesBackOnce = (
  sets: readonly ReturnType<typeof set>[],
  hold: (call: CellCall) => Promise<void> = async () => {
    await Promise.resolve();
  },
) => {
  const undone = new Set<string>();
  const landed: string[][] = [];
  const answer = async (call: CellCall): Promise<object> => {
    if (!onlineManager.isOnline()) {
      throw new TypeError("Failed to fetch");
    }
    await hold(call);
    if (call.path === "library.history.list") {
      return {
        changeSets: sets.map((held) => (undone.has(held.id) ? { ...held, undoneBy: "u1" } : held)),
        cursor: null,
      };
    }
    const { changeSetIds } = undoInput.parse(call.input);
    if (changeSetIds.some((id) => undone.has(id))) {
      throw createORPCErrorFromJson({
        code: "ALREADY_UNDONE",
        data: undefined,
        defined: true,
        message: ALREADY_UNDONE,
      });
    }
    for (const id of changeSetIds) {
      undone.add(id);
    }
    landed.push(changeSetIds);
    return UNDONE;
  };
  return { answer, landed };
};

const heldDown = (button: HTMLElement | undefined): boolean =>
  button?.hasAttribute("disabled") === true;

const twoTurnsDrawn = async () => {
  await waitFor(() => {
    expect(screen.getAllByRole("button", { name: "Undo this turn" })).toHaveLength(2);
  });
  return {
    turn: screen.getAllByRole("button", { name: "Undo this turn" })[0] ?? document.body,
    whole: screen.getByRole("button", { name: "Undo this conversation" }),
  };
};

const gone = async (): Promise<void> => {
  await waitFor(() => {
    expect(screen.queryByRole("button", { name: "Undo this turn" })).toBeNull();
  });
};

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
      expect(callsTo(calls, "library.agent.respond")).toStrictEqual([
        { eventId: "e1", result: "allow", threadId: THREAD },
      ]);
    });
  });

  it("shows the whole address before the person allows a link to be saved", async () => {
    const url = "https://collector.example/?d=the-persons-private-note";
    const { library } = fakePageLibrary({
      answer: ({ path }) =>
        path === "library.history.list"
          ? { changeSets: [], cursor: null }
          : { status: "running", threadId: THREAD },
      events: [
        row(0, {
          input: { url },
          name: "save_link",
          toolUseId: "toolu_1",
          type: "approval.asked",
          until: AT + 600_000,
        }),
      ],
      threads: [{ ...thread, status: "awaiting_approval" }],
    });
    renderOnLibrary(panel(), library);
    await expect(screen.findByText(url)).resolves.toBeDefined();
    expect(screen.getByText(/save a link from collector\.example/u)).toBeDefined();
  });

  it("offers Stop and no Undo of the conversation while a turn waits on the person", async () => {
    const { calls, library } = fakePageLibrary({
      answer: ({ path }) =>
        path === "library.history.list"
          ? { changeSets: [set("s1", 1)], cursor: null }
          : { status: "idle", threadId: THREAD },
      events: [
        row(0, { text: "File these.", type: "user.message" }),
        row(1, { reason: "done", turn: 1, type: "turn.ended" }),
        row(2, { text: "Bin the draft.", type: "user.message" }),
        row(3, {
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
    // the sets are in once the finished turn offers its own undo
    await screen.findByRole("button", { name: "Undo this turn" });
    expect(screen.queryByRole("button", { name: "Undo this conversation" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => {
      expect(callsTo(calls, "library.agent.cancel")).toStrictEqual([{ threadId: THREAD }]);
    });
  });

  it("undoes a turn's set once the open item is written, and the conversation from every page", async () => {
    const flushOpen = vi.fn<() => Promise<void>>(async () => {
      await Promise.resolve();
    });
    const { calls, library } = fakePageLibrary({
      // the conversation's sets come over two pages, the second asked once the first is in
      answer: ({ path, input }) => {
        if (path === "library.history.list") {
          return JSON.stringify(input).includes('"cursor":"1"')
            ? { changeSets: [set("s1", 1)], cursor: null }
            : { changeSets: [set("s2", 2)], cursor: "1" };
        }
        return { changeSetId: "u1", kept: [], lostText: [], refused: [], reverted: ["i1"] };
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
      expect(callsTo(calls, "library.history.undo")).toStrictEqual([{ changeSetIds: ["s1"] }]);
    });
    expect(flushOpen).toHaveBeenCalledOnce();
    const whole = screen.getByRole("button", { name: "Undo this conversation" });
    await waitFor(() => {
      expect(heldDown(whole)).toBe(false);
    });
    fireEvent.click(whole);
    await waitFor(() => {
      expect(callsTo(calls, "library.history.undo")).toStrictEqual([
        { changeSetIds: ["s1"] },
        { changeSetIds: ["s2", "s1"] },
      ]);
    });
  });

  it("takes back the turn the list on screen has yet to show", async () => {
    let listed = [set("s1", 1)];
    const { calls, library } = fakePageLibrary({
      answer: ({ path }) =>
        path === "library.history.list"
          ? { changeSets: listed, cursor: null }
          : { changeSetId: "u1", kept: [], lostText: [], refused: [], reverted: ["i1"] },
      events: [
        row(0, { text: "File these.", type: "user.message" }),
        row(1, { reason: "done", turn: 1, type: "turn.ended" }),
      ],
      threads: [thread],
    });
    renderOnLibrary(panel(), library);
    const whole = await screen.findByRole("button", { name: "Undo this conversation" });
    listed = [set("s2", 2), set("s1", 1)];
    fireEvent.click(whole);
    await waitFor(() => {
      expect(callsTo(calls, "library.history.undo")).toStrictEqual([
        { changeSetIds: ["s2", "s1"] },
      ]);
    });
  });

  it("says so when the conversation's sets can't be read at the press", async () => {
    const said = vi.spyOn(toast, "error");
    let readable = true;
    const { calls, library } = fakePageLibrary({
      answer: ({ path }) => {
        if (path === "library.history.list" && !readable) {
          throw new Error("unreachable");
        }
        return { changeSets: [set("s1", 1)], cursor: null };
      },
      events: oneFinishedTurn,
      threads: [thread],
    });
    renderOnLibrary(panel(), library);
    const whole = await screen.findByRole("button", { name: "Undo this conversation" });
    readable = false;
    vi.useFakeTimers();
    fireEvent.click(whole);
    await passTime(READ_RETRIES_MS);
    expect(said).toHaveBeenCalledWith("That couldn't be undone.");
    expect(callsTo(calls, "library.history.undo")).toStrictEqual([]);
  });

  it("reads again at the press when one read meets no answer", async () => {
    const said = vi.spyOn(toast, "error");
    let dropped = false;
    const { calls, library } = fakePageLibrary({
      answer: ({ path }) => {
        if (path !== "library.history.list") {
          return UNDONE;
        }
        if (dropped) {
          dropped = false;
          throw new TypeError("Failed to fetch");
        }
        return { changeSets: [set("s1", 1)], cursor: null };
      },
      events: oneFinishedTurn,
      threads: [thread],
    });
    renderOnLibrary(panel(), library);
    const whole = await screen.findByRole("button", { name: "Undo this conversation" });
    dropped = true;
    vi.useFakeTimers();
    fireEvent.click(whole);
    await passTime(READ_RETRIES_MS);
    expect(said).not.toHaveBeenCalled();
    expect(callsTo(calls, "library.history.undo")).toStrictEqual([{ changeSetIds: ["s1"] }]);
  });

  it("waits offline under the layout's notice, and goes once back online", async () => {
    const said = vi.spyOn(toast, "error");
    const { calls, library } = fakePageLibrary({
      // with no connection a call rejects, as fetch does
      answer: ({ path }) => {
        if (!onlineManager.isOnline()) {
          throw new TypeError("Failed to fetch");
        }
        return path === "library.history.list"
          ? { changeSets: [set("s1", 1)], cursor: null }
          : UNDONE;
      },
      events: oneFinishedTurn,
      threads: [thread],
    });
    renderOnLibrary(
      <>
        <PausedWrites />
        {panel()}
      </>,
      library,
    );
    const whole = await screen.findByRole("button", { name: "Undo this conversation" });
    setOnline(false);
    fireEvent.click(whole);
    await waitFor(() => {
      expect(noticeUp()).toBe(true);
    });
    // a second press has nothing to add to the one that waits
    fireEvent.click(whole);
    expect(said).not.toHaveBeenCalled();
    setOnline(true);
    await waitFor(() => {
      expect(callsTo(calls, "library.history.undo")).toStrictEqual([{ changeSetIds: ["s1"] }]);
    });
    await waitFor(() => {
      expect(noticeUp()).toBe(false);
    });
    expect(callsTo(calls, "library.history.undo")).toHaveLength(1);
    expect(said).not.toHaveBeenCalled();
  });

  it("stays down behind an undo in flight, then takes back what that one left", async () => {
    const answered = Promise.withResolvers<null>();
    const cell = takesBackOnce([set("s2", 2), set("s1", 1)], async ({ path }) => {
      if (path === "library.history.undo") {
        await answered.promise;
      }
    });
    const { calls, library } = fakePageLibrary({
      answer: cell.answer,
      events: twoFinishedTurns,
      threads: [thread],
    });
    renderOnLibrary(panel(), library);
    const { turn, whole } = await twoTurnsDrawn();
    fireEvent.click(turn);
    await waitFor(() => {
      expect(callsTo(calls, "library.history.undo")).toStrictEqual([{ changeSetIds: ["s1"] }]);
    });
    await waitFor(() => {
      expect(heldDown(whole)).toBe(true);
    });
    const reads = callsTo(calls, "library.history.list").length;
    fireEvent.click(whole);
    await act(async () => {
      await delay(0);
    });
    expect(callsTo(calls, "library.history.list")).toHaveLength(reads);
    answered.resolve(null);
    await waitFor(() => {
      expect(heldDown(whole)).toBe(false);
    });
    fireEvent.click(whole);
    await waitFor(() => {
      expect(cell.landed).toStrictEqual([["s1"], ["s2"]]);
    });
  });

  it("keeps to the conversation it was pressed in, whichever one is open when it goes", async () => {
    const { calls, library } = fakePageLibrary({
      answer: ({ path, input }) => {
        if (path !== "library.history.list") {
          return UNDONE;
        }
        return JSON.stringify(input).includes(OTHER_THREAD)
          ? { changeSets: [set("other", 1)], cursor: null }
          : { changeSets: [set("s1", 1)], cursor: null };
      },
      events: oneFinishedTurn,
      threads: [thread, { ...thread, id: OTHER_THREAD }],
    });
    renderOnLibrary(<Moving to={OTHER_THREAD} />, library);
    const whole = await screen.findByRole("button", { name: "Undo this conversation" });
    setOnline(false);
    fireEvent.click(whole);
    await waitFor(() => {
      expect(whole).toHaveProperty("disabled", true);
    });
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    setOnline(true);
    await waitFor(() => {
      expect(callsTo(calls, "library.history.undo")).toStrictEqual([{ changeSetIds: ["s1"] }]);
    });
  });

  it("keeps its button down through leaving the conversation and coming back", async () => {
    const said = vi.spyOn(toast, "error");
    const { calls, library } = fakePageLibrary({
      answer: ({ path }) =>
        path === "library.history.list" ? { changeSets: [set("s1", 1)], cursor: null } : UNDONE,
      events: oneFinishedTurn,
      threads: [thread],
    });
    renderOnLibrary(<Moving to={null} />, library);
    const whole = await screen.findByRole("button", { name: "Undo this conversation" });
    setOnline(false);
    fireEvent.click(whole);
    const move = screen.getByRole("button", { name: "Move" });
    fireEvent.click(move);
    expect(screen.queryByRole("button", { name: "Undo this conversation" })).toBeNull();
    fireEvent.click(move);
    const back = await screen.findByRole("button", { name: "Undo this conversation" });
    expect(back).toHaveProperty("disabled", true);
    fireEvent.click(back);
    setOnline(true);
    await waitFor(() => {
      expect(callsTo(calls, "library.history.undo")).toStrictEqual([{ changeSetIds: ["s1"] }]);
    });
    await waitFor(() => {
      expect(back).toHaveProperty("disabled", false);
    });
    expect(callsTo(calls, "library.history.undo")).toHaveLength(1);
    expect(said).not.toHaveBeenCalled();
  });

  describe("every Undo, while an undo waits", () => {
    it("stays down offline, so a second press has nothing to be refused", async () => {
      const refused = vi.spyOn(toast, "error");
      const undone = vi.spyOn(toast, "success");
      const cell = takesBackOnce([set("s1", 1)]);
      const { library } = fakePageLibrary({
        answer: cell.answer,
        events: oneFinishedTurn,
        threads: [thread],
      });
      renderOnLibrary(panel(), library);
      const turn = await screen.findByRole("button", { name: "Undo this turn" });
      setOnline(false);
      fireEvent.click(turn);
      await waitFor(() => {
        expect(heldDown(turn)).toBe(true);
      });
      fireEvent.click(turn);
      setOnline(true);
      await gone();
      await waitFor(() => {
        expect(undone).toHaveBeenCalledWith("Undone.");
      });
      expect(cell.landed).toStrictEqual([["s1"]]);
      expect(refused).not.toHaveBeenCalled();
    });

    it("stays down online until the undo is answered and the list read again", async () => {
      const refused = vi.spyOn(toast, "error");
      const answered = Promise.withResolvers<null>();
      const reread = Promise.withResolvers<null>();
      let pressed = false;
      const cell = takesBackOnce([set("s1", 1)], async ({ path }) => {
        if (pressed) {
          await (path === "library.history.undo" ? answered : reread).promise;
        }
      });
      const { library } = fakePageLibrary({
        answer: cell.answer,
        events: oneFinishedTurn,
        threads: [thread],
      });
      renderOnLibrary(panel(), library);
      const turn = await screen.findByRole("button", { name: "Undo this turn" });
      pressed = true;
      fireEvent.click(turn);
      await waitFor(() => {
        expect(heldDown(turn)).toBe(true);
      });
      fireEvent.click(turn);
      answered.resolve(null);
      await waitFor(() => {
        expect(cell.landed).toStrictEqual([["s1"]]);
      });
      await act(async () => {
        await delay(0);
      });
      expect(heldDown(turn)).toBe(true);
      fireEvent.click(turn);
      reread.resolve(null);
      await gone();
      expect(cell.landed).toStrictEqual([["s1"]]);
      expect(refused).not.toHaveBeenCalled();
    });

    it("stays down through leaving the conversation and coming back", async () => {
      const refused = vi.spyOn(toast, "error");
      const cell = takesBackOnce([set("s1", 1)]);
      const { library } = fakePageLibrary({
        answer: cell.answer,
        events: oneFinishedTurn,
        threads: [thread],
      });
      renderOnLibrary(<Moving to={null} />, library);
      const turn = await screen.findByRole("button", { name: "Undo this turn" });
      setOnline(false);
      fireEvent.click(turn);
      const move = screen.getByRole("button", { name: "Move" });
      fireEvent.click(move);
      expect(screen.queryByRole("button", { name: "Undo this turn" })).toBeNull();
      fireEvent.click(move);
      const back = await screen.findByRole("button", { name: "Undo this turn" });
      await waitFor(() => {
        expect(heldDown(back)).toBe(true);
      });
      fireEvent.click(back);
      setOnline(true);
      await gone();
      expect(cell.landed).toStrictEqual([["s1"]]);
      expect(refused).not.toHaveBeenCalled();
    });

    it("stays down behind a conversation press offline, which then lands whole", async () => {
      const refused = vi.spyOn(toast, "error");
      const cell = takesBackOnce([set("s2", 2), set("s1", 1)]);
      const { library } = fakePageLibrary({
        answer: cell.answer,
        events: twoFinishedTurns,
        threads: [thread],
      });
      renderOnLibrary(panel(), library);
      const { turn, whole } = await twoTurnsDrawn();
      setOnline(false);
      fireEvent.click(whole);
      await waitFor(() => {
        expect(heldDown(turn)).toBe(true);
      });
      fireEvent.click(turn);
      setOnline(true);
      await gone();
      expect(cell.landed).toStrictEqual([["s2", "s1"]]);
      expect(refused).not.toHaveBeenCalled();
    });

    it("stays down while a conversation press reads online, which then lands whole", async () => {
      const refused = vi.spyOn(toast, "error");
      const read = Promise.withResolvers<null>();
      let pressed = false;
      const cell = takesBackOnce([set("s2", 2), set("s1", 1)], async ({ path }) => {
        if (pressed && path === "library.history.list") {
          await read.promise;
        }
      });
      const { library } = fakePageLibrary({
        answer: cell.answer,
        events: twoFinishedTurns,
        threads: [thread],
      });
      renderOnLibrary(panel(), library);
      const { turn, whole } = await twoTurnsDrawn();
      pressed = true;
      fireEvent.click(whole);
      await waitFor(() => {
        expect(heldDown(turn)).toBe(true);
      });
      fireEvent.click(turn);
      read.resolve(null);
      await gone();
      expect(cell.landed).toStrictEqual([["s2", "s1"]]);
      expect(refused).not.toHaveBeenCalled();
    });

    it("holds from the press, however long the open item's write takes", async () => {
      const refused = vi.spyOn(toast, "error");
      const written = Promise.withResolvers<null>();
      const flushOpen = vi.fn<() => Promise<void>>(async () => {
        await written.promise;
      });
      const cell = takesBackOnce([set("s2", 2), set("s1", 1)]);
      const { calls, library } = fakePageLibrary({
        answer: cell.answer,
        events: twoFinishedTurns,
        threads: [thread],
      });
      renderOnLibrary(panel(flushOpen), library);
      const { turn, whole } = await twoTurnsDrawn();
      fireEvent.click(turn);
      await waitFor(() => {
        expect(heldDown(whole)).toBe(true);
      });
      expect(heldDown(turn)).toBe(true);
      fireEvent.click(whole);
      await act(async () => {
        await delay(0);
      });
      expect(callsTo(calls, "library.history.undo")).toStrictEqual([]);
      written.resolve(null);
      await waitFor(() => {
        expect(cell.landed).toStrictEqual([["s1"]]);
      });
      expect(refused).not.toHaveBeenCalled();
    });

    it("keeps a second press from a long conversation's undos until the last lands", async () => {
      const refused = vi.spyOn(toast, "error");
      const answered = Promise.withResolvers<null>();
      const sets = Array.from({ length: BULK_ITEMS_MAX + 1 }, (_, at) =>
        set(`s${String(at)}`, BULK_ITEMS_MAX + 1 - at),
      );
      const cell = takesBackOnce(sets, async ({ path }) => {
        if (path === "library.history.undo") {
          await answered.promise;
        }
      });
      const { calls, library } = fakePageLibrary({
        answer: cell.answer,
        events: oneFinishedTurn,
        threads: [thread],
      });
      renderOnLibrary(panel(), library);
      const whole = await screen.findByRole("button", { name: "Undo this conversation" });
      fireEvent.click(whole);
      await waitFor(() => {
        expect(callsTo(calls, "library.history.undo")).toHaveLength(1);
      });
      await waitFor(() => {
        expect(heldDown(whole)).toBe(true);
      });
      fireEvent.click(whole);
      answered.resolve(null);
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: "Undo this conversation" })).toBeNull();
      });
      expect(cell.landed.map((batch) => batch.length)).toStrictEqual([BULK_ITEMS_MAX, 1]);
      expect(refused).not.toHaveBeenCalled();
    });
  });

  it("reads the list again when an undo is refused, so what another device took back goes", async () => {
    const said = vi.spyOn(toast, "error");
    let listed = [set("s1", 1)];
    const { library } = fakePageLibrary({
      answer: ({ path }) => {
        if (path === "library.history.list") {
          return { changeSets: listed, cursor: null };
        }
        throw createORPCErrorFromJson({
          code: "ALREADY_UNDONE",
          data: undefined,
          defined: true,
          message: ALREADY_UNDONE,
        });
      },
      events: oneFinishedTurn,
      threads: [thread],
    });
    renderOnLibrary(panel(), library);
    const turn = await screen.findByRole("button", { name: "Undo this turn" });
    listed = [set("s1", 1, "u9")];
    fireEvent.click(turn);
    await waitFor(() => {
      expect(said).toHaveBeenCalledWith(ALREADY_UNDONE);
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Undo this turn" })).toBeNull();
    });
    expect(screen.queryByRole("button", { name: "Undo this conversation" })).toBeNull();
  });

  it.each([
    ["another device took it all back", [set("s1", 1, "u9")]],
    ["none of its sets is left", []],
  ])("sends nothing and says so when %s", async (_case, read) => {
    const said = vi.spyOn(toast, "info");
    const undone = vi.spyOn(toast, "success");
    let listed = [set("s1", 1)];
    const { calls, library } = fakePageLibrary({
      answer: () => ({ changeSets: listed, cursor: null }),
      events: oneFinishedTurn,
      threads: [thread],
    });
    renderOnLibrary(panel(), library);
    const whole = await screen.findByRole("button", { name: "Undo this conversation" });
    listed = read;
    fireEvent.click(whole);
    await waitFor(() => {
      expect(said).toHaveBeenCalledWith("There's nothing left to undo in this conversation.");
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Undo this conversation" })).toBeNull();
    });
    expect(screen.queryByRole("button", { name: "Undo this turn" })).toBeNull();
    expect(undone).not.toHaveBeenCalled();
    expect(callsTo(calls, "library.history.undo")).toStrictEqual([]);
  });

  it.each([
    ["kept part of it", { kept: ["i1"], reverted: ["i2"] }, "success", /^Undone, but/u],
    ["kept all of it", { kept: ["i1"], reverted: [] }, "info", /^Nothing was undone/u],
  ] as const)("says when a later change %s", async (_case, answer, kind, words) => {
    const said = vi.spyOn(toast, kind);
    const { library } = fakePageLibrary({
      answer: ({ path }) =>
        path === "library.history.list"
          ? { changeSets: [set("s1", 1)], cursor: null }
          : { changeSetId: null, lostText: [], refused: [], ...answer },
      events: [
        row(0, { text: "File these.", type: "user.message" }),
        row(1, { reason: "done", turn: 1, type: "turn.ended" }),
      ],
      threads: [thread],
    });
    renderOnLibrary(panel(), library);
    fireEvent.click(await screen.findByRole("button", { name: "Undo this turn" }));
    await waitFor(() => {
      expect(said).toHaveBeenCalledWith(expect.stringMatching(words));
    });
  });

  it("names the note whose typing went with the agent's words it took back", async () => {
    const said = vi.spyOn(toast, "warning");
    const cell = createFakeCell();
    const note = cell.seed.item({ title: "Plans" });
    const { library } = fakePageLibrary({
      answer: ({ path }) => {
        if (path === "library.history.list") {
          return { changeSets: [set("s1", 1)], cursor: null };
        }
        return path === "library.history.undo"
          ? { changeSetId: "u1", kept: [], lostText: [note], refused: [], reverted: [note] }
          : undefined;
      },
      cell,
      events: oneFinishedTurn,
      threads: [thread],
    });
    renderOnLibrary(panel(), library);
    fireEvent.click(await screen.findByRole("button", { name: "Undo this turn" }));
    await waitFor(() => {
      expect(said).toHaveBeenCalledWith("Undone.", {
        description: "What was typed inside the agent's words in “Plans” went with them.",
      });
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
        flushOpen={vi.fn<() => Promise<void>>(async () => {
          await Promise.resolve();
        })}
        tidying
        onTidyEnd={onTidyEnd}
        passage={null}
        onPassageTaken={vi.fn<() => void>()}
      />,
      library,
    );
    expect(screen.getByText(TIDY_LABEL)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(onThread).toHaveBeenCalledWith(THREAD);
    });
    expect(callsTo(calls, "library.agent.send")).toStrictEqual([
      { text: tidyMessage(""), viewContext: TIDY_VIEW_CONTEXT },
    ]);
    expect(onTidyEnd).toHaveBeenCalledOnce();
  });
});
