// @vitest-environment jsdom

import { setTimeout as delay } from "node:timers/promises";
import type { ThreadChangedMessage } from "@repo/api/local/notifications";
import type { TurnChanges, UndoTurnRequest } from "@repo/api/local/threads/threads-schema";
import { THREAD_CHANGE_KINDS } from "@repo/domain/change-kinds";
import type { ThreadChangeKind } from "@repo/domain/change-kinds";
import { Toaster, toast } from "@repo/ui/components/sonner";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubRpc } from "../../__tests__/rpc-stub";
import { ScriptedSocket } from "../../__tests__/scripted-socket";
import { WorkspaceProvider } from "../../workspace-context";
import { createTurnFinishWatch, turnFinishMessage, useTurnFinishToast } from "../turn-finish-toast";
import type { FinishedTurn } from "../turn-finish-toast";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // sonner replays every undismissed toast to the next Toaster that mounts.
  toast.dismiss();
});

const frame = (threadId: string, changes: readonly ThreadChangeKind[]): ThreadChangedMessage => ({
  changes,
  entity: "thread",
  id: threadId,
  type: "changed",
});

const RAN = frame("thr_1", ["events-appended"]);
const COMMITTED = frame("thr_1", ["changes-committed"]);

const applied = (turnId: string, paths: readonly string[]): TurnChanges => ({
  paths: [...paths],
  state: "applied",
  turnId,
});

const undone = (turnId: string, paths: readonly string[]): TurnChanges => ({
  paths: [...paths],
  state: "undone",
  turnId,
});

// a watch over one thread whose turns the test sets, with every announcement it made
const watching = (initial: readonly TurnChanges[] = []) => {
  let turns = initial;
  let reads = 0;
  const announced: FinishedTurn[] = [];
  const watch = createTurnFinishWatch({
    announce: (finished) => {
      announced.push(finished);
    },
    readTurns: async () => {
      reads += 1;
      return await Promise.resolve(turns);
    },
  });
  return {
    announced,
    // the reads chain on microtasks alone, so one macrotask lands every one of them
    observe: async (message: ThreadChangedMessage): Promise<void> => {
      watch.observe(message);
      await delay(0);
    },
    reads: () => reads,
    setTurns: (next: readonly TurnChanges[]) => {
      turns = next;
    },
    watch,
  };
};

const messages = (announced: readonly FinishedTurn[]): string[] =>
  announced.map((finished) => turnFinishMessage(finished.notePaths.length));

describe("which finished turn a commit frame announces", () => {
  it("announces each turn that finished after the thread's first frame, once", async () => {
    const thread = watching();
    await thread.observe(RAN);

    thread.setTurns([applied("turn_1", ["Plans.md"])]);
    await thread.observe(COMMITTED);
    await thread.observe(COMMITTED);
    thread.setTurns([
      applied("turn_1", ["Plans.md"]),
      applied("turn_2", ["Plans.md", "Ideas.md", "Inbox.md"]),
    ]);
    await thread.observe(RAN);
    await thread.observe(COMMITTED);

    expect(thread.announced).toEqual([
      { notePaths: ["Plans.md"], threadId: "thr_1", turnId: "turn_1" },
      { notePaths: ["Plans.md", "Ideas.md", "Inbox.md"], threadId: "thr_1", turnId: "turn_2" },
    ]);
    expect(messages(thread.announced)).toEqual(["Agent edited 1 note", "Agent edited 3 notes"]);
  });

  it("announces a turn that changed only what the user did not write, or nothing, not at all", async () => {
    const thread = watching();
    await thread.observe(RAN);

    const metadataOnly = applied("turn_1", [".inteligir/comments/note-1.json"]);
    thread.setTurns([metadataOnly]);
    await thread.observe(COMMITTED);
    thread.setTurns([metadataOnly, applied("turn_2", [])]);
    await thread.observe(RAN);
    await thread.observe(COMMITTED);

    expect(thread.announced).toEqual([]);
  });

  it("announces no turn the thread held before the window opened", async () => {
    const replied = watching([applied("turn_1", ["Plans.md"]), applied("turn_2", ["Ideas.md"])]);
    await replied.observe(RAN);
    await replied.observe(COMMITTED);

    // the thread's first frame is an undo of its older turn, from the panel or the command line
    const undoneFirst = watching([undone("turn_1", ["Plans.md"]), applied("turn_2", ["Ideas.md"])]);
    await undoneFirst.observe(COMMITTED);

    expect(replied.announced).toEqual([]);
    expect(undoneFirst.announced).toEqual([]);
  });

  it("announces nothing for the undo's own frame, whichever turn it took back", async () => {
    const thread = watching();
    await thread.observe(RAN);
    thread.setTurns([applied("turn_1", ["Plans.md"])]);
    await thread.observe(COMMITTED);
    thread.setTurns([applied("turn_1", ["Plans.md"]), applied("turn_2", ["Ideas.md"])]);
    await thread.observe(RAN);
    await thread.observe(COMMITTED);

    thread.setTurns([undone("turn_1", ["Plans.md"]), applied("turn_2", ["Ideas.md"])]);
    await thread.observe(COMMITTED);
    thread.setTurns([undone("turn_1", ["Plans.md"]), undone("turn_2", ["Ideas.md"])]);
    await thread.observe(COMMITTED);

    expect(thread.announced.map((finished) => finished.turnId)).toEqual(["turn_1", "turn_2"]);
  });

  it("announces a turn whose commit landed while the thread's first read was out", async () => {
    const firstRead = Promise.withResolvers<readonly TurnChanges[]>();
    const announced: FinishedTurn[] = [];
    let reads = 0;
    const watch = createTurnFinishWatch({
      announce: (finished) => {
        announced.push(finished);
      },
      readTurns: async () => {
        reads += 1;
        return reads === 1 ? await firstRead.promise : [applied("turn_1", ["Plans.md"])];
      },
    });

    watch.observe(RAN);
    watch.observe(COMMITTED);
    // the read went out before the commit and came back after it, holding the turn
    firstRead.resolve([applied("turn_1", ["Plans.md"])]);
    await delay(0);

    expect(announced.map((finished) => finished.turnId)).toEqual(["turn_1"]);
  });

  it("announces the newest turn of a thread first heard in the flush that committed it", async () => {
    const thread = watching([applied("turn_1", ["Plans.md"])]);
    await thread.observe(
      frame("thr_1", ["events-appended", "status-changed", "changes-committed"]),
    );

    expect(thread.announced.map((finished) => finished.turnId)).toEqual(["turn_1"]);
  });

  it("reads nothing for a reconnect sweep, which names no thread", async () => {
    const thread = watching([applied("turn_1", ["Plans.md"])]);
    await thread.observe({ changes: THREAD_CHANGE_KINDS, entity: "thread", type: "changed" });

    expect(thread.reads()).toBe(0);
    expect(thread.announced).toEqual([]);
  });

  it("announces nothing once disposed", async () => {
    const thread = watching();
    await thread.observe(RAN);
    thread.setTurns([applied("turn_1", ["Plans.md"])]);
    thread.watch.dispose();
    await thread.observe(COMMITTED);

    expect(thread.announced).toEqual([]);
  });
});

const FinishToasts = ({ onShowHistory }: { onShowHistory: (path: string) => void }) => {
  useTurnFinishToast(onShowHistory);
  return null;
};

describe("the finish toast", () => {
  it("offers the turn back, and the undo's summary opens the History of the note it left", async () => {
    let turns: TurnChanges[] = [];
    let reads = 0;
    const undoCalls: unknown[] = [];
    stubRpc({
      "threads/turnChanges": () => {
        reads += 1;
        return { turns };
      },
      "threads/undoTurn": (input) => {
        undoCalls.push(input);
        return { kept: [{ path: "Plans.md", reason: "edited-since" }], reverted: ["Ideas.md"] };
      },
    });
    vi.stubGlobal("WebSocket", ScriptedSocket);
    const showHistory = vi.fn<(path: string) => void>();
    render(
      <WorkspaceProvider>
        <Toaster />
        <FinishToasts onShowHistory={showHistory} />
      </WorkspaceProvider>,
    );
    await waitFor(() => {
      expect(ScriptedSocket.live.size).toBe(1);
    });

    ScriptedSocket.deliverToAll(RAN);
    await waitFor(() => {
      expect(reads).toBe(1);
    });
    turns = [applied("turn_1", ["Plans.md", "Ideas.md", "Inbox.md"])];
    ScriptedSocket.deliverToAll(COMMITTED);

    expect(await screen.findByText("Agent edited 3 notes")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    const request: UndoTurnRequest = { threadId: "thr_1", turnId: "turn_1" };
    expect(
      await screen.findByText(
        "Undid the agent's changes to 1 note. Left Plans.md as it is: edited since.",
      ),
    ).toBeDefined();
    expect(undoCalls).toEqual([request]);
    fireEvent.click(screen.getByRole("button", { name: "Open History" }));
    expect(showHistory).toHaveBeenCalledWith("Plans.md");
  });
});
