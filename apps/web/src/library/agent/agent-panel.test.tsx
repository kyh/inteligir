import { setTimeout as delay } from "node:timers/promises";
import { createORPCErrorFromJson } from "@orpc/client";
import { NEEDS_CONNECTION } from "@repo/contract/needs-connection";
import { deferred } from "@repo/contract/deferred";
import { toast } from "@repo/ui/components/sonner";
import { onlineManager } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { PausedWrites } from "../cloud/needs-connection";
import { usePageLibrary } from "../cloud/library-context";
import type { PageLibrary } from "../cloud/library-context";
import { fakePageLibrary, renderOnLibrary } from "../test-support/fake-page-library.test-utils";
import type {
  CellCall,
  ThreadEventRow,
  ThreadRow,
} from "../test-support/fake-page-library.test-utils";
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

const row = (idx: number, event: ThreadEventRow["event"]) =>
  ({
    at: AT + idx,
    event,
    eventId: `e${String(idx)}`,
    threadId: THREAD,
    type: "event",
  }) satisfies ThreadEventRow;

const writesNothing = async () => {
  await Promise.resolve();
};

const panel = (flushOpen = writesNothing) => (
  <AgentPanel viewContext={() => {}} flushOpen={flushOpen} />
);

const onThread = (library: PageLibrary) => {
  library.workspace.compose({ kind: "chose", threadId: THREAD });

  return library;
};

const tidyPanel = (
  <AgentPanel viewContext={() => ({ itemId: THREAD, surface: "item" })} flushOpen={writesNothing} />
);

const callsTo = (calls: readonly CellCall[], path: string) =>
  calls.flatMap((call) => (call.path === path ? [call.input] : []));

const oneFinishedTurn = [
  row(0, { text: "File these.", type: "user.message" }),
  row(1, { reason: "done", turn: 1, type: "turn.ended" }),
];

const NOTHING_LEFT = { kept: [], next: null, refused: [], reverted: [] };
const UNDONE = { ...NOTHING_LEFT, reverted: ["i1"] };

const Moving = ({ to }: { to: string | null }) => {
  const { workspace } = usePageLibrary();

  return (
    <>
      <button
        type="button"
        onClick={() => {
          const { target } = workspace.store.getState().composer;
          const here = target.kind === "asking" && target.threadId === THREAD;
          workspace.compose({ kind: "chose", threadId: here ? to : THREAD });
        }}
      >
        Move
      </button>
      {panel()}
    </>
  );
};

const noticeUp = () =>
  toast.getToasts().some((shown) => "title" in shown && shown.title === NEEDS_CONNECTION);

const setOnline = (online: boolean) => {
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

const takesBackOnce = (
  turns: readonly number[],
  hold: (call: CellCall) => Promise<void> = async () => {
    await Promise.resolve();
  },
) => {
  const left = new Set(turns);
  const landed: number[][] = [];

  const answer = async (call: CellCall) => {
    if (!onlineManager.isOnline()) {
      throw new TypeError("Failed to fetch");
    }

    await hold(call);

    if (call.path === "library.agent.undoable") {
      return { turns: [...left].toSorted((a, b) => a - b) } satisfies object;
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

const heldDown = (button: HTMLElement | undefined) => button?.hasAttribute("disabled") === true;

const twoTurnsDrawn = async () => {
  await waitFor(() => {
    expect(screen.getAllByRole("button", { name: "Undo this turn" })).toHaveLength(2);
  });

  return {
    turn: screen.getAllByRole("button", { name: "Undo this turn" })[0] ?? document.body,
    whole: screen.getByRole("button", { name: "Undo this conversation" }),
  };
};

const gone = async () => {
  await waitFor(() => {
    expect(screen.queryByRole("button", { name: "Undo this turn" })).toBeNull();
  });
};

describe("the agent panel's conversation", () => {
  it("draws the reply as it is written, under the words that it works, with Stop", async () => {
    const { library } = fakePageLibrary({
      answer: () => ({ turns: [] }),
      draft: "Filing the first",
      events: [row(0, { text: "File these.", type: "user.message" })],
      threads: [thread],
    });

    renderOnLibrary(panel(), onThread(library));
    await expect(screen.findByText("Filing the first")).resolves.toBeDefined();
    expect(screen.getByText("Working…")).toBeDefined();
    expect(screen.getByRole("button", { name: "Stop" })).toBeDefined();
  });

  it("offers Stop and no Undo of the conversation while a turn runs", async () => {
    const { calls, library } = fakePageLibrary({
      answer: ({ path }) =>
        path === "library.agent.undoable" ? { turns: [1] } : { status: "idle", threadId: THREAD },
      events: [
        row(0, { text: "File these.", type: "user.message" }),
        row(1, { reason: "done", turn: 1, type: "turn.ended" }),
        row(2, { text: "Bin the draft.", type: "user.message" }),
      ],
      threads: [thread],
    });

    renderOnLibrary(panel(), onThread(library));
    await screen.findByRole("button", { name: "Undo this turn" });
    expect(screen.queryByRole("button", { name: "Undo this conversation" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => {
      expect(callsTo(calls, "library.agent.cancel")).toStrictEqual([{ threadId: THREAD }]);
    });
  });

  it("undoes a turn by its number once the open item is written, and the conversation by its thread", async () => {
    const written = { flushOpen: writesNothing };
    const flushOpen = vi.spyOn(written, "flushOpen");

    const { calls, library } = fakePageLibrary({
      answer: ({ path }) => (path === "library.agent.undoable" ? { turns: [1, 2] } : UNDONE),
      events: twoFinishedTurns,
      threads: [thread],
    });

    renderOnLibrary(panel(flushOpen), onThread(library));
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

    renderOnLibrary(panel(), onThread(library));
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

    renderOnLibrary(panel(), onThread(library));
    const whole = await screen.findByRole("button", { name: "Undo this conversation" });
    fireEvent.click(whole);
    await waitFor(() => {
      expect(callsTo(calls, "library.agent.undo")).toHaveLength(2);
    });
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
      onThread(library),
    );
    const whole = await screen.findByRole("button", { name: "Undo this conversation" });
    setOnline(false);
    fireEvent.click(whole);
    await waitFor(() => {
      expect(noticeUp()).toBe(true);
    });
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

    renderOnLibrary(panel(), onThread(library));
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

    renderOnLibrary(<Moving to={OTHER_THREAD} />, onThread(library));
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

      renderOnLibrary(panel(), onThread(library));
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

      renderOnLibrary(panel(), onThread(library));
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

        renderOnLibrary(<Moving to={null} />, onThread(library));
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

      renderOnLibrary(panel(), onThread(library));
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

      const flushOpen = async () => {
        await written.promise;
      };

      const cell = takesBackOnce([1, 2]);

      const { calls, library } = fakePageLibrary({
        answer: cell.answer,
        events: twoFinishedTurns,
        threads: [thread],
      });

      renderOnLibrary(panel(flushOpen), onThread(library));
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

    renderOnLibrary(panel(), onThread(library));
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
      let turns = [1];

      const { calls, library } = fakePageLibrary({
        answer: ({ path }) => (path === "library.agent.undoable" ? { turns } : NOTHING_LEFT),
        events: oneFinishedTurn,
        threads: [thread],
      });

      renderOnLibrary(panel(), onThread(library));
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

    renderOnLibrary(panel(), onThread(library));
    fireEvent.click(await screen.findByRole("button", { name: "Undo this turn" }));
    await waitFor(() => {
      expect(said).toHaveBeenCalledWith(expect.stringMatching(words));
    });
  });

  it("sends Tidy my library from Unsorted, with nothing typed, and lets the request go once sent", async () => {
    const { calls, library } = fakePageLibrary({
      answer: () => ({ status: "running", threadId: THREAD }),
    });

    library.workspace.compose({ kind: "tidy" });
    renderOnLibrary(tidyPanel, library);
    expect(screen.getByText(TIDY_LABEL)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(library.workspace.store.getState().composer.target).toStrictEqual({
        kind: "asking",
        threadId: THREAD,
      });
    });
    expect(callsTo(calls, "library.agent.send")).toStrictEqual([
      { text: tidyMessage(""), viewContext: TIDY_VIEW_CONTEXT },
    ]);
    expect(screen.queryByText(TIDY_LABEL)).toBeNull();
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

    library.workspace.compose({ kind: "tidy" });
    renderOnLibrary(tidyPanel, library);
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
