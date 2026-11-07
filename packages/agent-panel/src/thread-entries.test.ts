import { createORPCErrorFromJson } from "@orpc/client";
import type { threadEventRowSchema } from "@repo/contract/cloud/library/library-wire";
import type { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  answerWords,
  endingWords,
  isWorking,
  sendRefusalWords,
  statusWords,
  readsOnly,
  threadBlocks,
  threadEntries,
  toolWords,
  waitingApprovals,
  workWords,
} from "./thread-entries";

const THREAD = "0199a4c2-0000-7000-8000-000000000001";

const row = (idx: number, event: z.infer<typeof threadEventRowSchema>["event"]) => ({
  at: 1_790_000_000_000 + idx,
  event,
  eventId: `${THREAD}:1:${String(idx)}`,
  idx,
  seq: idx,
  threadId: THREAD,
  type: "x",
});

const asked = {
  input: { ids: [] },
  name: "delete_items",
  toolUseId: "t1",
  type: "approval.asked",
  until: 9,
};

describe("a thread's entries", () => {
  it("reads the stored events in order and skips one this build cannot parse", () => {
    const entries = threadEntries([
      row(2, { text: "Done.", type: "agent.message" }),
      row(0, { text: "File these.", type: "user.message" }),
      row(1, { kind: "from a newer cell", type: "agent.future" }),
    ]);
    expect(entries.map(({ event }) => event.type)).toStrictEqual(["user.message", "agent.message"]);
  });

  it("names the approval still waiting by the event that asked, until it is answered", () => {
    const waiting = threadEntries([row(0, asked)]);
    expect(waitingApprovals(waiting)).toStrictEqual([
      { eventId: `${THREAD}:1:0`, name: "delete_items", until: 9 },
    ]);
    const answered = threadEntries([
      row(0, asked),
      row(1, { by: "person", result: "allow", toolUseId: "t1", type: "approval.answered" }),
    ]);
    expect(waitingApprovals(answered)).toStrictEqual([]);
  });

  it("says a tool and an ending in the person's words", () => {
    expect(toolWords("search_library")).toBe("Searched the library");
    expect(toolWords("a_tool_from_later")).toBe("Used the library");
    expect(endingWords("done")).toBe("");
    expect(endingWords("cancelled")).toBe("Stopped.");
  });

  it("says a finished run of work by its calls, and an answered approval", () => {
    expect(workWords(0)).toBe("Thought it through");
    expect(workWords(1)).toBe("Worked through 1 step");
    expect(workWords(3)).toBe("Worked through 3 steps");
    expect(answerWords("allow")).toBe("Allowed.");
    expect(answerWords("deny")).toBe("Declined.");
  });
});

// a refusal as the client reads one the procedure declared
const refused = (code: string, data?: { readonly resetsAt: number }) =>
  createORPCErrorFromJson({ code, data, defined: true, message: code });

describe("a refused send", () => {
  it("says the allowance is used, and when it fills again", () => {
    const budget = refused("AGENT_BUDGET", { resetsAt: Date.UTC(2026, 10, 6, 0, 0) });
    expect(sendRefusalWords(budget, Date.UTC(2026, 10, 5, 12, 0))).toMatch(
      /^The agent has used today’s allowance\. It’s back at /u,
    );
  });

  it("says the agent is off or out of reach, and any other refusal in its own sentence", () => {
    const off = refused("SERVICE_UNAVAILABLE");
    expect(sendRefusalWords(off, 0)).toMatch(/turn it on in Settings/u);
    expect(sendRefusalWords(refused("NOT_FOUND"), 0)).toBe("NOT_FOUND");
    expect(sendRefusalWords(new Error("offline"), 0)).toBe("The agent couldn't be reached.");
  });
});

describe("a conversation's blocks", () => {
  it("draws a run of the agent's notes and calls as one block, each call with how it ended", () => {
    const blocks = threadBlocks(
      threadEntries([
        row(0, { text: "File these.", type: "user.message" }),
        row(1, { text: "Looking first.", type: "agent.progress" }),
        row(2, { input: {}, name: "search_library", toolUseId: "a", type: "agent.tool_use" }),
        row(3, { isError: false, summary: "[]", toolUseId: "a", type: "agent.tool_result" }),
        row(4, { input: {}, name: "organize_items", toolUseId: "b", type: "agent.tool_use" }),
        row(5, { isError: true, summary: "Not found.", toolUseId: "b", type: "agent.tool_result" }),
        row(6, asked),
        row(7, { text: "Done.", type: "agent.message" }),
      ]),
    );
    expect(blocks.map((block) => block.kind)).toStrictEqual(["entry", "work", "entry"]);
    const [, work] = blocks;
    expect(work?.kind === "work" ? work.notes : null).toStrictEqual([
      { eventId: `${THREAD}:1:1`, text: "Looking first." },
    ]);
    expect(
      work?.kind === "work" ? work.uses.map((use) => [use.name, use.failure]) : null,
    ).toStrictEqual([
      ["search_library", null],
      ["organize_items", "Not found."],
    ]);
  });

  it("tells a call that only reads from one that writes", () => {
    expect(readsOnly("read_item")).toBe(true);
    expect(readsOnly("edit_item")).toBe(false);
  });
});

describe("a thread's state", () => {
  it("says nothing while it rests, and a turn under way is working", () => {
    expect(statusWords("idle")).toBe("");
    expect(statusWords("awaiting_approval")).toBe("Waiting for you");
    expect(isWorking("running")).toBe(true);
    expect(isWorking("queued")).toBe(true);
    expect(isWorking("awaiting_approval")).toBe(false);
  });
});
