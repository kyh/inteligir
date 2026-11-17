import { setTimeout as delay } from "node:timers/promises";
import { createORPCErrorFromJson } from "@orpc/client";
import { NEEDS_CONNECTION } from "@repo/contract/needs-connection";
import { deferred } from "@repo/contract/deferred";
import { createFakeCell } from "@repo/contract/test-support/fake-cell";
import { toast } from "@repo/ui/components/sonner";
import { onlineManager } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { PausedWrites } from "../cloud/needs-connection";
import { fakePageLibrary, renderOnLibrary } from "../test-support/fake-page-library";
import type { CellCall, ThreadEventRow, ThreadRow } from "../test-support/fake-page-library";
import type { ComposerEvent } from "./agent-composer";
import { AgentPanel } from "./agent-panel";
import { TIDY_LABEL, TIDY_PLACEHOLDER, TIDY_VIEW_CONTEXT, tidyMessage } from "./tidy-library";

afterEach(() => {
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
});

const THREAD = "0199a4c2-0000-7000-8000-00000000000a";
const OTHER_THREAD = "0199a4c2-0000-7000-8000-00000000000b";
const AT = 1_793_000_000_000;

const thread: ThreadRow = {
  createdAt: AT,
  id: THREAD,
  status: "idle",
  title: "Tidying",
  updatedAt: AT,
};

const row = (idx: number, event: ThreadEventRow["event"]): ThreadEventRow => ({
  at: AT + idx,
  event,
  eventId: `e${String(idx)}`,
  idx,
  threadId: THREAD,
  type: "event",
});

const panel = (
  flushOpen = vi.fn<() => Promise<void>>(async () => {
    await Promise.resolve();
  }),
  threadId: string | null = THREAD,
) => (
  <AgentPanel
    composer={{ kind: "asking", passage: null, threadId }}
    dispatch={vi.fn<(event: ComposerEvent) => void>()}
    viewContext={() => {}}
    flushOpen={flushOpen}
  />
);

const callsTo = (calls: readonly CellCall[], path: string): unknown[] =>
  calls.filter((call) => call.path === path).map((call) => call.input);

// the reply being written as the panel draws it, or null while it draws none
const previewShown = (): string | null =>
  document.querySelector("[data-agent-preview]")?.textContent ?? null;

const oneFinishedTurn = [
  row(0, { text: "File these.", type: "user.message" }),
  row(1, { reason: "done", turn: 1, type: "turn.ended" }),
];

const NOTHING_LEFT = { kept: [], lostText: [], next: null, refused: [], reverted: [] };
const UNDONE = { ...NOTHING_LEFT, reverted: ["i1"] };

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

const twoFinishedTurns = [
  ...oneFinishedTurn,
  row(2, { text: "And these.", type: "user.message" }),
  row(3, { reason: "done", turn: 2, type: "turn.ended" }),
];

const undoInput = z.object({ threadId: z.string(), turn: z.number().optional() });

// the cell's own rule, as cell-undo.ts keeps it: a turn goes back once, an undo of one already
// back takes nothing, and with no connection a call meets no answer. `hold` keeps a call from
// being answered until the suite says
const takesBackOnce = (
  turns: readonly number[],
  hold: (call: CellCall) => Promise<void> = async () => {
    await Promise.resolve();
  },
) => {
  const left = new Set(turns);
  const landed: number[][] = [];
  const answer = async (call: CellCall): Promise<object> => {
    if (!onlineManager.isOnline()) {
      throw new TypeError("Failed to fetch");
    }
    await hold(call);
    if (call.path === "library.agent.undoable") {
      return { turns: [...left].toSorted((a, b) => a - b) };
    }
    const { turn } = undoInput.parse(call.input);
    const taken = [...left]
      .filter((one) => turn === undefined || one === turn)
      .toSorted((a, b) => b - a);
    for (const one of taken) {
      left.delete(one);
    }
    landed.push(taken);
    return taken.length === 0 ? NOTHING_LEFT : UNDONE;
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

// a delete of one item, waiting on the person
const deleteAsked = (idx: number): ThreadEventRow =>
  row(idx, {
    ask: { ids: ["x"], kind: "delete" },
    toolUseId: "toolu_1",
    type: "approval.asked",
    until: AT + 600_000,
  });

describe("the agent panel's conversation", () => {
  it("answers an approval by the event that asked it", async () => {
    const { calls, library } = fakePageLibrary({
      answer: ({ path }) =>
        path === "library.agent.undoable" ? { turns: [] } : { status: "running", threadId: THREAD },
      events: [row(0, { text: "Bin the draft.", type: "user.message" }), deleteAsked(1)],
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

  it("holds an approval's options while its answer is on the way, and hands them back when it is refused", async () => {
    const refused = vi.spyOn(toast, "error");
    const answers = [deferred<object>(), deferred<object>()];
    const { calls, library } = fakePageLibrary({
      answer: async ({ path }) =>
        path === "library.agent.respond"
          ? await answers[callsTo(calls, path).length - 1]?.promise
          : { turns: [] },
      events: [deleteAsked(0)],
      threads: [{ ...thread, status: "awaiting_approval" }],
    });
    renderOnLibrary(panel(), library);
    const approve = await screen.findByRole("button", { name: "Approve" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(approve);
    await waitFor(() => {
      expect(heldDown(cancel)).toBe(true);
    });
    fireEvent.click(cancel);
    answers[0]?.reject(
      createORPCErrorFromJson({
        code: "NOT_FOUND",
        data: undefined,
        defined: true,
        message: "That conversation is gone.",
      }),
    );
    await waitFor(() => {
      expect(heldDown(approve)).toBe(false);
    });
    expect(refused).toHaveBeenCalledWith("That conversation is gone.");
    expect(approve.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(cancel);
    answers[1]?.resolve({ status: "running", threadId: THREAD });
    await waitFor(() => {
      expect(cancel.getAttribute("aria-pressed")).toBe("true");
    });
    await act(async () => {
      await delay(0);
    });
    // answered, and held until the thread drops the card
    expect(heldDown(approve)).toBe(true);
    expect(callsTo(calls, "library.agent.respond")).toStrictEqual([
      { eventId: "e0", result: "allow", threadId: THREAD },
      { eventId: "e0", result: "deny", threadId: THREAD },
    ]);
  });

  it("shows the whole address before the person allows a link to be saved", async () => {
    const url = "https://collector.example/?d=the-persons-private-note";
    const { library } = fakePageLibrary({
      answer: ({ path }) =>
        path === "library.agent.undoable" ? { turns: [] } : { status: "running", threadId: THREAD },
      events: [
        row(0, {
          ask: { kind: "save", url },
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

  it("draws the reply being written in its own conversation, until a write moves the thread", async () => {
    const fake = fakePageLibrary({
      answer: ({ path }) => (path === "library.agent.undoable" ? { turns: [] } : undefined),
      events: [row(0, { text: "File these.", type: "user.message" })],
      threads: [{ ...thread, status: "running" }],
    });
    renderOnLibrary(panel(), fake.library);
    await screen.findByText("File these.");

    act(() => {
      fake.preview({ text: "Elsewhere", threadId: OTHER_THREAD });
    });
    expect(previewShown()).toBeNull();
    act(() => {
      fake.preview({ text: "Filing", threadId: THREAD });
    });
    await waitFor(() => {
      expect(previewShown()).toBe("Filing");
    });
    act(() => {
      fake.preview({ text: null, threadId: OTHER_THREAD });
    });
    expect(previewShown()).toBe("Filing");
    act(() => {
      fake.preview({ text: null, threadId: THREAD });
    });
    expect(previewShown()).toBeNull();
    act(() => {
      fake.preview({ text: "Filed", threadId: THREAD });
    });
    await waitFor(() => {
      expect(previewShown()).toBe("Filed");
    });
    act(() => {
      fake.preview({ text: null, threadId: null });
    });
    expect(previewShown()).toBeNull();
  });

  it("offers Stop and no Undo of the conversation while a turn waits on the person", async () => {
    const { calls, library } = fakePageLibrary({
      answer: ({ path }) =>
        path === "library.agent.undoable" ? { turns: [1] } : { status: "idle", threadId: THREAD },
      events: [
        row(0, { text: "File these.", type: "user.message" }),
        row(1, { reason: "done", turn: 1, type: "turn.ended" }),
        row(2, { text: "Bin the draft.", type: "user.message" }),
        deleteAsked(3),
      ],
      threads: [{ ...thread, status: "awaiting_approval" }],
    });
    renderOnLibrary(panel(), library);
    // the turns left to undo are in once the finished turn offers its own undo
    await screen.findByRole("button", { name: "Undo this turn" });
    expect(screen.queryByRole("button", { name: "Undo this conversation" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => {
      expect(callsTo(calls, "library.agent.cancel")).toStrictEqual([{ threadId: THREAD }]);
    });
  });

  it("undoes a turn by its number once the open item is written, and the conversation by its thread", async () => {
    const flushOpen = vi.fn<() => Promise<void>>(async () => {
      await Promise.resolve();
    });
    const { calls, library } = fakePageLibrary({
      answer: ({ path }) => (path === "library.agent.undoable" ? { turns: [1, 2] } : UNDONE),
      events: twoFinishedTurns,
      threads: [thread],
    });
    renderOnLibrary(panel(flushOpen), library);
    const { turn, whole } = await twoTurnsDrawn();
    fireEvent.click(turn);
    await waitFor(() => {
      expect(callsTo(calls, "library.agent.undo")).toStrictEqual([{ threadId: THREAD, turn: 1 }]);
    });
    expect(flushOpen).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(heldDown(whole)).toBe(false);
    });
    fireEvent.click(whole);
    await waitFor(() => {
      expect(callsTo(calls, "library.agent.undo")).toStrictEqual([
        { threadId: THREAD, turn: 1 },
        { threadId: THREAD },
      ]);
    });
  });

  it("offers an Undo only for a turn with something left to take back, once that is read", async () => {
    const read = deferred();
    const { library } = fakePageLibrary({
      answer: async ({ path }) => {
        if (path !== "library.agent.undoable") {
          return UNDONE;
        }
        await read.promise;
        return { turns: [2] };
      },
      events: twoFinishedTurns,
      threads: [thread],
    });
    renderOnLibrary(panel(), library);
    await waitFor(() => {
      expect(document.querySelectorAll("[data-turn-ended]")).toHaveLength(2);
    });
    expect(screen.queryByRole("button", { name: "Undo this turn" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo this conversation" })).toBeNull();
    read.resolve();
    const turn = await screen.findByRole("button", { name: "Undo this turn" });
    expect(turn.closest<HTMLElement>("[data-turn-ended]")?.dataset.turnEnded).toBe("2");
    expect(screen.getAllByRole("button", { name: "Undo this turn" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Undo this conversation" })).toBeDefined();
  });

  it("asks on from where each call left a long conversation, and answers the press once", async () => {
    const refused = vi.spyOn(toast, "error");
    const undone = vi.spyOn(toast, "success");
    const answered = deferred();
    const { calls, library } = fakePageLibrary({
      answer: async ({ path }) => {
        if (path === "library.agent.undoable") {
          return { turns: callsTo(calls, "library.agent.undo").length < 2 ? [1, 2, 3] : [] };
        }
        if (callsTo(calls, path).length === 1) {
          return { ...UNDONE, next: 2 };
        }
        await answered.promise;
        return { ...UNDONE, reverted: ["i2"] };
      },
      events: oneFinishedTurn,
      threads: [thread],
    });
    renderOnLibrary(panel(), library);
    const whole = await screen.findByRole("button", { name: "Undo this conversation" });
    fireEvent.click(whole);
    await waitFor(() => {
      expect(callsTo(calls, "library.agent.undo")).toHaveLength(2);
    });
    // held from the press until the last call lands, so a second press has nothing to ask
    expect(heldDown(whole)).toBe(true);
    fireEvent.click(whole);
    expect(undone).not.toHaveBeenCalled();
    answered.resolve();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Undo this conversation" })).toBeNull();
    });
    expect(callsTo(calls, "library.agent.undo")).toStrictEqual([
      { threadId: THREAD },
      { before: 2, threadId: THREAD },
    ]);
    expect(undone).toHaveBeenCalledExactlyOnceWith("Undone.");
    expect(refused).not.toHaveBeenCalled();
  });

  it("waits offline under the layout's notice, and goes once back online", async () => {
    const said = vi.spyOn(toast, "error");
    const { calls, library } = fakePageLibrary({
      // with no connection a call rejects, as fetch does
      answer: ({ path }) => {
        if (!onlineManager.isOnline()) {
          throw new TypeError("Failed to fetch");
        }
        return path === "library.agent.undoable" ? { turns: [1] } : UNDONE;
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
      expect(callsTo(calls, "library.agent.undo")).toStrictEqual([{ threadId: THREAD }]);
    });
    await waitFor(() => {
      expect(noticeUp()).toBe(false);
    });
    expect(callsTo(calls, "library.agent.undo")).toHaveLength(1);
    expect(said).not.toHaveBeenCalled();
  });

  it("stays down behind an undo in flight, then takes back what that one left", async () => {
    const answered = deferred();
    const cell = takesBackOnce([1, 2], async ({ path }) => {
      if (path === "library.agent.undo") {
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
      expect(callsTo(calls, "library.agent.undo")).toStrictEqual([{ threadId: THREAD, turn: 1 }]);
    });
    await waitFor(() => {
      expect(heldDown(whole)).toBe(true);
    });
    fireEvent.click(whole);
    await act(async () => {
      await delay(0);
    });
    expect(callsTo(calls, "library.agent.undo")).toHaveLength(1);
    answered.resolve();
    await waitFor(() => {
      expect(heldDown(whole)).toBe(false);
    });
    fireEvent.click(whole);
    await waitFor(() => {
      expect(cell.landed).toStrictEqual([[1], [2]]);
    });
  });

  it("keeps to the conversation it was pressed in, whichever one is open when it goes", async () => {
    const { calls, library } = fakePageLibrary({
      answer: ({ path }) => (path === "library.agent.undoable" ? { turns: [1] } : UNDONE),
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
      expect(callsTo(calls, "library.agent.undo")).toStrictEqual([{ threadId: THREAD }]);
    });
  });

  describe("every Undo, while an undo waits", () => {
    it("stays down offline, so a second press has nothing to ask", async () => {
      const refused = vi.spyOn(toast, "error");
      const undone = vi.spyOn(toast, "success");
      const cell = takesBackOnce([1]);
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
      expect(cell.landed).toStrictEqual([[1]]);
      expect(refused).not.toHaveBeenCalled();
    });

    it("stays down online until the undo is answered and the turns left are read again", async () => {
      const refused = vi.spyOn(toast, "error");
      const answered = deferred();
      const reread = deferred();
      let pressed = false;
      const cell = takesBackOnce([1], async ({ path }) => {
        if (pressed) {
          await (path === "library.agent.undo" ? answered : reread).promise;
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
      answered.resolve();
      await waitFor(() => {
        expect(cell.landed).toStrictEqual([[1]]);
      });
      await act(async () => {
        await delay(0);
      });
      expect(heldDown(turn)).toBe(true);
      fireEvent.click(turn);
      reread.resolve();
      await gone();
      expect(cell.landed).toStrictEqual([[1]]);
      expect(refused).not.toHaveBeenCalled();
    });

    it.each(["Undo this turn", "Undo this conversation"])(
      "keeps %s down through leaving the conversation and coming back",
      async (name) => {
        const refused = vi.spyOn(toast, "error");
        const cell = takesBackOnce([1]);
        const { library } = fakePageLibrary({
          answer: cell.answer,
          events: oneFinishedTurn,
          threads: [thread],
        });
        renderOnLibrary(<Moving to={null} />, library);
        const pressed = await screen.findByRole("button", { name });
        setOnline(false);
        fireEvent.click(pressed);
        const move = screen.getByRole("button", { name: "Move" });
        fireEvent.click(move);
        expect(screen.queryByRole("button", { name })).toBeNull();
        fireEvent.click(move);
        const back = await screen.findByRole("button", { name });
        await waitFor(() => {
          expect(heldDown(back)).toBe(true);
        });
        fireEvent.click(back);
        setOnline(true);
        await gone();
        expect(cell.landed).toStrictEqual([[1]]);
        expect(refused).not.toHaveBeenCalled();
      },
    );

    it("stays down behind a conversation press offline, which then lands whole", async () => {
      const refused = vi.spyOn(toast, "error");
      const cell = takesBackOnce([1, 2]);
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
      expect(cell.landed).toStrictEqual([[2, 1]]);
      expect(refused).not.toHaveBeenCalled();
    });

    it("holds from the press, however long the open item's write takes", async () => {
      const refused = vi.spyOn(toast, "error");
      const written = deferred();
      const flushOpen = vi.fn<() => Promise<void>>(async () => {
        await written.promise;
      });
      const cell = takesBackOnce([1, 2]);
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
      expect(callsTo(calls, "library.agent.undo")).toStrictEqual([]);
      written.resolve();
      await waitFor(() => {
        expect(cell.landed).toStrictEqual([[1]]);
      });
      expect(refused).not.toHaveBeenCalled();
    });
  });

  it("says why when a rule refuses an undo, and reads again the turns left", async () => {
    const said = vi.spyOn(toast, "error");
    const held = "Another item in your library already holds this link.";
    let turns = [1];
    const { library } = fakePageLibrary({
      answer: ({ path }) => {
        if (path === "library.agent.undoable") {
          return { turns };
        }
        throw createORPCErrorFromJson({
          code: "CONFLICT",
          data: undefined,
          defined: true,
          message: held,
        });
      },
      events: oneFinishedTurn,
      threads: [thread],
    });
    renderOnLibrary(panel(), library);
    const turn = await screen.findByRole("button", { name: "Undo this turn" });
    turns = [];
    fireEvent.click(turn);
    await waitFor(() => {
      expect(said).toHaveBeenCalledWith(held);
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Undo this turn" })).toBeNull();
    });
    expect(screen.queryByRole("button", { name: "Undo this conversation" })).toBeNull();
  });

  it.each(["Undo this turn", "Undo this conversation"])(
    "says there is nothing left when another device took it back before %s was pressed",
    async (name) => {
      const said = vi.spyOn(toast, "info");
      const undone = vi.spyOn(toast, "success");
      const refused = vi.spyOn(toast, "error");
      // this device's list is a frame behind the other's undo
      let turns = [1];
      const { calls, library } = fakePageLibrary({
        answer: ({ path }) => (path === "library.agent.undoable" ? { turns } : NOTHING_LEFT),
        events: oneFinishedTurn,
        threads: [thread],
      });
      renderOnLibrary(panel(), library);
      const pressed = await screen.findByRole("button", { name });
      turns = [];
      fireEvent.click(pressed);
      await waitFor(() => {
        expect(said).toHaveBeenCalledWith("There's nothing left to undo.");
      });
      await gone();
      expect(screen.queryByRole("button", { name: "Undo this conversation" })).toBeNull();
      expect(callsTo(calls, "library.agent.undo")).toHaveLength(1);
      expect(undone).not.toHaveBeenCalled();
      expect(refused).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["kept part of it", { kept: ["i1"], reverted: ["i2"] }, "success", /^Undone, but/u],
    ["kept all of it", { kept: ["i1"], reverted: [] }, "info", /^Nothing was undone/u],
  ] as const)("says when a later change %s", async (_case, answer, kind, words) => {
    const said = vi.spyOn(toast, kind);
    const { library } = fakePageLibrary({
      answer: ({ path }) =>
        path === "library.agent.undoable" ? { turns: [1] } : { ...NOTHING_LEFT, ...answer },
      events: oneFinishedTurn,
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
        if (path === "library.agent.undoable") {
          return { turns: [1] };
        }
        return path === "library.agent.undo"
          ? { ...NOTHING_LEFT, lostText: [note], reverted: [note] }
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
    const dispatch = vi.fn<(event: ComposerEvent) => void>();
    const { calls, library } = fakePageLibrary({
      answer: () => ({ status: "running", threadId: THREAD }),
    });
    renderOnLibrary(
      <AgentPanel
        composer={{ kind: "tidying" }}
        dispatch={dispatch}
        viewContext={() => ({ itemId: THREAD, surface: "item" })}
        flushOpen={vi.fn<() => Promise<void>>(async () => {
          await Promise.resolve();
        })}
      />,
      library,
    );
    expect(screen.getByText(TIDY_LABEL)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    // the conversation it went to, which lets the Tidy go (`./agent-composer`)
    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith({ kind: "chose", threadId: THREAD });
    });
    expect(callsTo(calls, "library.agent.send")).toStrictEqual([
      { text: tidyMessage(""), viewContext: TIDY_VIEW_CONTEXT },
    ]);
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("sends Tidy my library as a new conversation from Unsorted, with what the person adds, whatever is open", async () => {
    const { calls, library } = fakePageLibrary({
      answer: (call) =>
        call.path === "library.agent.send"
          ? { status: "running", threadId: OTHER_THREAD }
          : undefined,
      events: oneFinishedTurn,
      threads: [thread],
    });
    renderOnLibrary(
      <AgentPanel
        composer={{ kind: "tidying" }}
        dispatch={vi.fn<(event: ComposerEvent) => void>()}
        viewContext={() => ({ itemId: THREAD, surface: "item" })}
        flushOpen={vi.fn<() => Promise<void>>(async () => {
          await Promise.resolve();
        })}
      />,
      library,
    );
    fireEvent.change(screen.getByPlaceholderText(TIDY_PLACEHOLDER), {
      target: { value: " Skip recipes " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(callsTo(calls, "library.agent.send")).toStrictEqual([
        { text: tidyMessage("Skip recipes"), viewContext: TIDY_VIEW_CONTEXT },
      ]);
    });
  });
});
