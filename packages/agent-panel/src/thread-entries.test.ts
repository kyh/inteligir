import { createORPCErrorFromJson } from "@orpc/client";
import type { threadEventRowSchema } from "@repo/contract/library/library-wire";
import type { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  answerWords,
  approvalWords,
  conversationOf,
  endingWords,
  isUnderWay,
  isWorking,
  sendRefusalWords,
  statusWords,
  readsOnly,
  toolWords,
  workWords,
} from "./thread-entries";
import type { ThreadBlock } from "./thread-entries";

const THREAD = "0199a4c2-0000-7000-8000-000000000001";

type StoredEvent = z.infer<typeof threadEventRowSchema>["event"];

const row = (idx: number, event: StoredEvent) => ({
  at: 1_790_000_000_000 + idx,
  event,
  eventId: `${THREAD}:1:${String(idx)}`,
  idx,
  threadId: THREAD,
  type: "x",
});

// a conversation of `events`, stored in the order given
const conversation = (...events: readonly StoredEvent[]) =>
  conversationOf(events.map((event, idx) => row(idx, event)));

const asked = {
  input: { ids: ["item-1"] },
  name: "delete_items",
  toolUseId: "t1",
  type: "approval.asked",
  until: 9,
};

const answered = (by: string, result: string) => ({
  by,
  result,
  toolUseId: "t1",
  type: "approval.answered",
});

const ended = (reason: string) => ({ reason, turn: 1, type: "turn.ended" });

const used = (toolUseId: string, name = "search_library") => ({
  input: {},
  name,
  toolUseId,
  type: "agent.tool_use",
});

const result = (toolUseId: string, isError = false, summary = "[]") => ({
  isError,
  summary,
  toolUseId,
  type: "agent.tool_result",
});

// the approval waiting on a call of `name` with `input`
const askedFor = (name: string, input: z.infer<ReturnType<typeof z.json>>) => {
  const [approval] = conversation({ ...asked, input, name }).waiting;
  if (approval === undefined) {
    throw new Error("no approval is waiting");
  }
  return approval;
};

const typesOf = (blocks: readonly ThreadBlock[]) =>
  blocks.map((block) => (block.kind === "entry" ? block.entry.event.type : "work"));

// every call the conversation's runs of work show, by its id, as it stands
const usesOf = (blocks: readonly ThreadBlock[]) =>
  blocks.flatMap((block) => (block.kind === "work" ? block.uses : []));

const noTitles = (): null => null;

describe("a thread's entries", () => {
  it("reads the stored events in order and skips one this build cannot parse", () => {
    const { blocks } = conversationOf([
      row(2, { text: "Done.", type: "agent.message" }),
      row(0, { text: "File these.", type: "user.message" }),
      row(1, { kind: "from a newer cell", type: "agent.future" }),
    ]);
    expect(typesOf(blocks)).toStrictEqual(["user.message", "agent.message"]);
  });

  it("names the approval still waiting by the event that asked, until it is answered", () => {
    expect(conversation(asked).waiting).toStrictEqual([
      { ask: { ids: ["item-1"], kind: "delete" }, eventId: `${THREAD}:1:0` },
    ]);
    const settled = conversation(asked, answered("person", "allow"));
    expect(settled.waiting).toStrictEqual([]);
    expect(typesOf(settled.blocks)).toStrictEqual(["approval.answered"]);
  });

  it("lapses a question its turn ended without an answer to, so no card is left up", () => {
    const stopped = conversation(asked, ended("cancelled"));
    expect(stopped.waiting).toStrictEqual([]);
    expect(typesOf(stopped.blocks)).toStrictEqual(["turn.ended"]);
    // an answer after the turn ended draws nothing: the question had lapsed
    expect(
      typesOf(conversation(asked, ended("failed"), answered("cancel", "deny")).blocks),
    ).toStrictEqual(["turn.ended"]);
  });

  it("skips an answer before its question, and a second answer", () => {
    const early = conversation(answered("person", "deny"), asked);
    expect(early.blocks).toStrictEqual([]);
    expect(early.waiting).toHaveLength(1);
    const twice = conversation(asked, answered("person", "allow"), answered("timeout", "deny"));
    expect(typesOf(twice.blocks)).toStrictEqual(["approval.answered"]);
  });

  it("says how many items a delete would move, naming those this device holds", () => {
    const titles = new Map([
      ["a", "Trip plan"],
      ["b", "Recipes"],
    ]);
    const titleOf = (id: string): string | null => titles.get(id) ?? null;
    const three = askedFor("delete_items", { ids: ["a", "b", "not-here-yet"] });
    expect(approvalWords(three, titleOf)).toStrictEqual({
      detail: "Trip plan, Recipes and 1 more",
      question: "The agent wants to move 3 items to Deleted. You can restore them from there.",
    });
    expect(approvalWords(askedFor("delete_items", { ids: ["a"] }), titleOf)).toStrictEqual({
      detail: "Trip plan",
      question: "The agent wants to move an item to Deleted. You can restore it from there.",
    });
    expect(approvalWords(three, noTitles).detail).toBeNull();
  });

  it("counts an id the call names twice once, and names a long delete's first titles", () => {
    expect(
      approvalWords(askedFor("delete_items", { ids: ["a", "a"] }), noTitles).question,
    ).toContain("an item");
    const ids = Array.from({ length: 100 }, (_, index) => String(index));
    const { detail, question } = approvalWords(askedFor("delete_items", { ids }), (id) => `#${id}`);
    expect(question).toContain("100 items");
    expect(detail).toBe("#0, #1, #2, #3, #4, #5, #6, #7, #8, #9 and 90 more");
  });

  it("shows the whole address a save would send a site, as the library would read it", () => {
    const approval = askedFor("save_link", {
      url: "https://good.example@collector.example/?d=my%20private%20note&utm_source=x",
    });
    expect(approvalWords(approval, noTitles)).toStrictEqual({
      detail: "https://collector.example/?d=my%20private%20note",
      question:
        "The agent wants to save a link from collector.example. Reading its page shows that site this whole address.",
    });
  });

  it("claims nothing of a call it cannot read", () => {
    const unread = { detail: null, question: "The agent wants to use the library." };
    expect(approvalWords(askedFor("save_link", { url: "not a link" }), noTitles)).toStrictEqual(
      unread,
    );
    expect(approvalWords(askedFor("delete_items", { ids: [] }), noTitles)).toStrictEqual(unread);
    expect(approvalWords(askedFor("a_later_tool", {}), noTitles)).toStrictEqual(unread);
  });

  it("says a tool and an ending in the person's words", () => {
    expect(toolWords("search_library")).toBe("Searched the library");
    expect(toolWords("a_tool_from_later")).toBe("Used the library");
    expect(endingWords("done")).toBe("");
    expect(endingWords("cancelled")).toBe("Stopped.");
    expect(endingWords("budget")).toBe(
      "Stopped: the agent did as much as one turn may. Ask it to go on.",
    );
  });

  it("says a finished run of work by its calls", () => {
    expect(workWords(0)).toBe("Thought it through");
    expect(workWords(1)).toBe("Worked through 1 step");
    expect(workWords(3)).toBe("Worked through 3 steps");
  });

  it("says who settled an approval: the person, its time running out, or the turn stopped", () => {
    expect(answerWords({ by: "person", result: "allow" })).toBe("Allowed.");
    expect(answerWords({ by: "person", result: "deny" })).toBe("Declined.");
    expect(answerWords({ by: "timeout", result: "deny" })).toBe(
      "Not answered in time, so it didn't run.",
    );
    expect(answerWords({ by: "cancel", result: "deny" })).toBe(
      "Stopped before you answered, so it didn't run.",
    );
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
    const { blocks } = conversation(
      { text: "File these.", type: "user.message" },
      { text: "Looking first.", type: "agent.progress" },
      used("a"),
      result("a"),
      used("b", "organize_items"),
      result("b", true, "Not found."),
      used("c", "read_item"),
      asked,
      { text: "Done.", type: "agent.message" },
    );
    expect(typesOf(blocks)).toStrictEqual(["user.message", "work", "agent.message"]);
    const [, work] = blocks;
    expect(work?.kind === "work" ? work.notes : null).toStrictEqual([
      { eventId: `${THREAD}:1:1`, text: "Looking first." },
    ]);
    expect(usesOf(blocks)).toStrictEqual([
      { kind: "done", name: "search_library", toolUseId: "a" },
      { kind: "failed", message: "Not found.", name: "organize_items", toolUseId: "b" },
      { kind: "running", name: "read_item", toolUseId: "c" },
    ]);
  });

  it("lands a call's result after its approval closed the run that made it", () => {
    const { blocks } = conversation(
      used("t1", "delete_items"),
      used("s"),
      asked,
      result("s"),
      answered("person", "allow"),
      result("t1"),
    );
    expect(typesOf(blocks)).toStrictEqual(["work", "approval.answered"]);
    expect(usesOf(blocks).map((use) => [use.toolUseId, use.kind])).toStrictEqual([
      ["t1", "done"],
      ["s", "done"],
    ]);
  });

  it("skips a result before its call, and a second result", () => {
    const { blocks } = conversation(
      result("a", true, "Too early."),
      used("a"),
      result("a"),
      result("a", true, "Again."),
    );
    expect(typesOf(blocks)).toStrictEqual(["work"]);
    expect(usesOf(blocks)).toStrictEqual([
      { kind: "done", name: "search_library", toolUseId: "a" },
    ]);
  });

  it("tells a call that only reads from one that writes", () => {
    expect(readsOnly("read_item")).toBe(true);
    expect(readsOnly("edit_item")).toBe(false);
  });
});

describe("a thread's state", () => {
  it("says nothing while it rests, and is working unless it rests or waits on the person", () => {
    expect(statusWords("idle")).toBe("");
    expect(statusWords("awaiting_approval")).toBe("Waiting for you");
    expect(isWorking("running")).toBe(true);
    expect(isWorking("queued")).toBe(true);
    expect(isWorking("awaiting_approval")).toBe(false);
  });

  it("holds a turn waiting on the person as under way, which Stop ends", () => {
    expect(isUnderWay("running")).toBe(true);
    expect(isUnderWay("queued")).toBe(true);
    expect(isUnderWay("awaiting_approval")).toBe(true);
    expect(isUnderWay("idle")).toBe(false);
  });
});
