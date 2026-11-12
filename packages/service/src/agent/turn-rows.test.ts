// A thread's status as its rows say it: worked out from its open turn and its queued sends alone,
// and written as each push of its object moves them.

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { AgentEvent } from "@repo/contract/library/agent-events";
import { openCellLibrary } from "../library/cell-library";
import { agentAccount, cellRows, threadStatus } from "../test-support/agent-turns";
import type { AgentAccount } from "../test-support/agent-turns";
import { agentCellIn, inCell } from "../test-support/library-cell";
import { openTurnInCell } from "../test-support/thread-host";
import { landPush } from "./agent-turns";
import { threadStatusOf } from "./turn-rows";

const asked: AgentEvent = {
  input: { url: "https://example.com/a" },
  name: "save_link",
  toolUseId: "toolu_01",
  type: "approval.asked",
  until: Date.now() + 600_000,
};

const answered: AgentEvent = {
  by: "person",
  result: "allow",
  toolUseId: "toolu_01",
  type: "approval.answered",
};

const ended: AgentEvent = { reason: "done", turn: 1, type: "turn.ended" };

// each event pushed by the thread's object in a push of its own, and the status after each
const statusesAfter = async (
  account: AgentAccount,
  threadId: string,
  events: readonly AgentEvent[],
): Promise<(string | null)[]> => {
  const statuses: (string | null)[] = [];
  for (const [index, event] of events.entries()) {
    await inCell(account.cell, async (state) => {
      const cell = agentCellIn(state, openCellLibrary(state, env));
      await landPush(cell, {
        events: [event],
        seq: index + 1,
        threadId,
        turn: 1,
      });
    });
    statuses.push(await threadStatus(account, threadId));
  }
  return statuses;
};

describe("a thread's status", () => {
  it("reads its open turn before its queue", () => {
    expect(threadStatusOf({ open: { waiting: 1 }, queued: 2 })).toBe("awaiting_approval");
    expect(threadStatusOf({ open: { waiting: 0 }, queued: 2 })).toBe("running");
    expect(threadStatusOf({ open: null, queued: 1 })).toBe("queued");
    expect(threadStatusOf({ open: null, queued: 0 })).toBe("idle");
  });

  it("follows an approval asked and answered, and the turn's end", async () => {
    const account = agentAccount();
    const threadId = crypto.randomUUID();
    await openTurnInCell(account, threadId, "Save it.");
    await expect(threadStatus(account, threadId)).resolves.toBe("running");
    await expect(statusesAfter(account, threadId, [asked, answered, ended])).resolves.toStrictEqual(
      ["awaiting_approval", "running", "idle"],
    );
  });

  it("counts no answer nothing waited for, so the next ask still waits on the person", async () => {
    const account = agentAccount();
    const threadId = crypto.randomUUID();
    await openTurnInCell(account, threadId, "Save it.");
    await expect(statusesAfter(account, threadId, [answered, asked])).resolves.toStrictEqual([
      "running",
      "awaiting_approval",
    ]);
    await expect(
      cellRows(account, "SELECT waiting FROM agent_turns WHERE thread_id = ?", threadId),
    ).resolves.toStrictEqual([{ waiting: 1 }]);
  });
});
