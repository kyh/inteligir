import { createORPCErrorFromJson } from "@orpc/client";
import { undoKeptReasonSchema } from "@repo/api/local/threads/threads-schema";
import { registerOpenNoteStore } from "@repo/editor/note/open-note-flush";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import { bootThreadHarness } from "inteligir/server/testing";
import { describe, expect, it, onTestFinished } from "vitest";
import { summarizeUndo, undoTurnChanges } from "../undo-turn";
import type { UndoTurnApi } from "../undo-turn";

const REQUEST = { threadId: "thr_1", turnId: "turn_1" };

// the product never says how the undo is done underneath.
const ENGINE_WORDS = /\b(?:commit|revert|git)/iu;

// a refusal as the wire hands it over: a code the contract defines.
const refusing = (code: string, message: string): UndoTurnApi => ({
  threads: {
    undoTurn: async () => {
      await Promise.resolve();
      throw createORPCErrorFromJson({
        code,
        data: undefined,
        defined: true,
        inferable: true,
        message,
      });
    },
  },
});

describe("undoing a turn", () => {
  it("lands the open note's buffer before it asks for the undo", async () => {
    const calls: string[] = [];
    const store = createOpenNoteStore();
    store.setFlush(async () => {
      await Promise.resolve();
      calls.push("flush");
      return true;
    });
    onTestFinished(registerOpenNoteStore(store));
    const api: UndoTurnApi = {
      threads: {
        undoTurn: async () => {
          calls.push("undo");
          return await Promise.resolve({ kept: [], reverted: ["a.md"] });
        },
      },
    };

    const outcome = await undoTurnChanges(api, REQUEST);

    expect(calls).toEqual(["flush", "undo"]);
    expect(outcome).toEqual({ changes: { kept: [], reverted: ["a.md"] }, kind: "undone" });
  });

  it("says a running or already undone turn has nothing to take back, never the server's ids", async () => {
    const outcome = await undoTurnChanges(
      refusing("CONFLICT", "Turn turn_1 was already undone"),
      REQUEST,
    );

    expect(outcome).toEqual({
      kind: "refused",
      message: "Nothing to undo: the agent is still working, or these changes were undone already.",
    });
  });

  it("says why a turn this device holds no record of cannot be undone here", async () => {
    const { client } = await bootThreadHarness({ mode: "manual" });
    const { thread } = await client.threads.create({});

    const outcome = await undoTurnChanges(client, { threadId: thread.id, turnId: "turn_gone" });

    expect(outcome).toEqual({
      kind: "refused",
      message: "These changes were not made on this device, so they can't be undone here.",
    });
  });

  it("keeps the words of a failure the contract does not name", async () => {
    const outcome = await undoTurnChanges(
      {
        threads: {
          undoTurn: async () => {
            await Promise.resolve();
            throw new Error("Failed to fetch");
          },
        },
      },
      REQUEST,
    );

    expect(outcome).toEqual({ kind: "refused", message: "Failed to fetch" });
  });
});

describe("the undo's summary", () => {
  it("counts the notes it took back", () => {
    expect(summarizeUndo({ kept: [], reverted: ["a.md", "b.md", "c.md"] })).toEqual({
      historyPath: null,
      message: "Undid the agent's changes to 3 notes.",
      tone: "success",
    });
    expect(summarizeUndo({ kept: [], reverted: ["a.md"] }).message).toBe(
      "Undid the agent's changes to 1 note.",
    );
  });

  it("warns about the one note it left, and points at that note's History", () => {
    expect(
      summarizeUndo({
        kept: [{ path: "Plans.md", reason: "edited-since" }],
        reverted: ["a.md", "b.md"],
      }),
    ).toEqual({
      historyPath: "Plans.md",
      message: "Undid the agent's changes to 2 notes. Left Plans.md as it is: edited since.",
      tone: "warning",
    });
  });

  it("offers no History for the one note it left because it is gone", () => {
    expect(
      summarizeUndo({ kept: [{ path: "Plans.md", reason: "deleted-since" }], reverted: [] }),
    ).toEqual({
      historyPath: null,
      message: "Nothing was undone. Left Plans.md as it is: deleted since.",
      tone: "warning",
    });
  });

  it("names every note it left, and offers no one History for several", () => {
    const summary = summarizeUndo({
      kept: [
        { path: "Plans.md", reason: "edited-since" },
        { path: "Ideas.md", reason: "deleted-since" },
      ],
      reverted: [],
    });

    expect(summary).toEqual({
      historyPath: null,
      message:
        "Nothing was undone. Left 2 notes as they are: Plans.md (edited since), Ideas.md (deleted since).",
      tone: "warning",
    });
  });

  it("says so when the notes were already back", () => {
    expect(summarizeUndo({ kept: [], reverted: [] })).toEqual({
      historyPath: null,
      message: "The notes were already as they were before the agent's changes.",
      tone: "success",
    });
  });

  it.each(undoKeptReasonSchema.options)("words %s plainly", (reason) => {
    const { message } = summarizeUndo({ kept: [{ path: "Plans.md", reason }], reverted: [] });

    expect(message).toMatch(/^Nothing was undone\. Left Plans\.md as it is: \S.*\.$/u);
    expect(message).not.toContain(reason);
    expect(message).not.toMatch(ENGINE_WORDS);
  });
});
