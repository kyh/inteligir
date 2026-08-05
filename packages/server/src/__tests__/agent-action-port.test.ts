// ---------------------------------------------------------------------------
// The MUTATING agent capabilities (boot/agent-action-port.ts), driven over
// fakes. What is pinned here is what the tool DESCRIPTIONS promise a model:
// every target is probed against live disk, a whole-file rewind asks a human
// first, undo reaches only this conversation's captures, and delegation cannot
// queue an unbounded number of its own successors in one turn.
//
// Knowledge-privacy has the read side; this is the write side, and the reason
// it is separate is that a refusal here is a VALUE the model relays rather than
// a row that silently disappears.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from "vitest";

import {
  buildAgentActionPort,
  type ActionDelegations,
  type ActionRestores,
  type ActionVault,
} from "../boot/agent-action-port";
import type {
  AgentActionOk,
  AgentActionPort,
  AgentDelegateResult,
  PrivacyProbe,
} from "@repo/agent/extension";
import type { ConfirmationProposal } from "../agent-confirm/confirmation-broker";

/** The refusal sentence, or a failure — the assertions below are about the
 * words the model relays, so an unexpected success must not read as one. */
function reasonOf(result: AgentActionOk | AgentDelegateResult): string {
  if (result.ok) throw new Error("expected a refusal, got a success");
  return result.reason;
}

const PUBLIC_NOTE = "chores.md";
const PRIVATE_NOTE = "secret-plans.md";

type Harness = {
  port: AgentActionPort;
  proposals: ConfirmationProposal[];
  restored: string[];
  cancelled: string[];
  created: number;
  turn: () => void;
};

function harness(
  opts: {
    answer?: boolean;
    createFails?: string;
    sessionStartedAt?: number;
    snapshots?: Record<string, { id: string; capturedAt: number }>;
    delegations?: Record<string, string>;
  } = {},
): Harness {
  const proposals: ConfirmationProposal[] = [];
  const restored: string[] = [];
  const cancelled: string[] = [];
  const delegationsById = opts.delegations ?? { "task-1": PUBLIC_NOTE };
  const state = { created: 0, turn: 1 };

  const vault: ActionVault = {
    readText: () => "- [ ] a task\n",
    writeText: () => {},
    trash: async () => true,
  };
  const delegations: ActionDelegations = {
    createDelegation: () => {
      if (opts.createFails !== undefined) return { ok: false, error: opts.createFails };
      state.created += 1;
      return {
        ok: true,
        delegation: {
          id: `delegation-${state.created}`,
          sourceFile: PUBLIC_NOTE,
          anchor: { ordinal: 0, text: "- [ ] a task", heading: null },
          lineText: "- [ ] a task",
          status: "queued",
          createdAt: 1,
          startedAt: null,
          finishedAt: null,
          resultSummary: null,
          error: null,
          hasSnapshot: false,
          restoredAt: null,
          transcriptPath: null,
        },
      };
    },
    cancelDelegation: (id) => {
      cancelled.push(id);
      return { ok: true };
    },
    restoreSnapshot: async (id) => {
      restored.push(id);
      return { ok: true };
    },
    find: (id) => {
      const sourceFile = delegationsById[id];
      return sourceFile === undefined ? null : { sourceFile };
    },
  };
  const restores: ActionRestores = {
    latestChatEdit: (path, since) => {
      const snapshot = opts.snapshots?.[path];
      if (snapshot === undefined || snapshot.capturedAt < since) return null;
      return snapshot;
    },
    restoreChatEdit: async (id) => {
      restored.push(id);
      return { ok: true };
    },
  };

  const port = buildAgentActionPort({
    probe: (rel): PrivacyProbe => (rel === PRIVATE_NOTE ? "private" : "public"),
    vault: () => vault,
    delegations: () => delegations,
    restores: () => restores,
    capture: () => {},
    confirm: async (proposal) => {
      proposals.push(proposal);
      return opts.answer ?? true;
    },
    chatSessionStartedAt: () => opts.sessionStartedAt ?? 0,
    turnSequence: () => state.turn,
    onStaleProjection: () => {},
  });

  return {
    port,
    proposals,
    restored,
    cancelled,
    get created() {
      return state.created;
    },
    turn: () => {
      state.turn += 1;
    },
  };
}

describe("delegate_task's per-turn cap", () => {
  it("refuses past the cap, and the refusal names the limit", () => {
    const h = harness();
    for (let i = 0; i < 3; i += 1) {
      expect(h.port.delegateTask(PUBLIC_NOTE, i)).toMatchObject({ ok: true });
    }
    expect(reasonOf(h.port.delegateTask(PUBLIC_NOTE, 3))).toContain("3 tasks");
    expect(h.created).toBe(3);
  });

  it("resets on the next turn", () => {
    const h = harness();
    for (let i = 0; i < 3; i += 1) h.port.delegateTask(PUBLIC_NOTE, i);
    h.turn();
    expect(h.port.delegateTask(PUBLIC_NOTE, 0)).toMatchObject({ ok: true });
  });

  it("spends no budget on a delegation the manager itself refused", () => {
    const h = harness({ createFails: "no AI provider is connected" });
    for (let i = 0; i < 5; i += 1) {
      expect(h.port.delegateTask(PUBLIC_NOTE, i)).toMatchObject({
        ok: false,
        reason: "no AI provider is connected",
      });
    }
  });
});

describe("the id-keyed delegation actions probe the task's note", () => {
  it("cancel refuses when the source note reads private now", () => {
    const h = harness({ delegations: { "task-1": PRIVATE_NOTE } });
    const result = h.port.cancelDelegation("task-1");
    expect(result).toMatchObject({ ok: false });
    expect(h.cancelled).toEqual([]);
  });

  it("restore refuses when the source note reads private now, without asking", async () => {
    const h = harness({ delegations: { "task-1": PRIVATE_NOTE } });
    await expect(h.port.restoreDelegation("task-1")).resolves.toMatchObject({ ok: false });
    expect(h.proposals).toEqual([]);
    expect(h.restored).toEqual([]);
  });

  it("an unknown id is a refusal, not a probe of nothing", async () => {
    const h = harness();
    expect(h.port.cancelDelegation("nope")).toMatchObject({ ok: false });
    await expect(h.port.restoreDelegation("nope")).resolves.toMatchObject({ ok: false });
  });
});

describe("restore_delegation is the destructive tier", () => {
  it("asks the human, naming the note, before rewinding", async () => {
    const h = harness();
    await expect(h.port.restoreDelegation("task-1")).resolves.toEqual({ ok: true });
    expect(h.proposals).toHaveLength(1);
    expect(h.proposals[0]?.title).toContain(PUBLIC_NOTE);
    expect(h.proposals[0]?.detail).toContain("everything written to the note since");
    expect(h.restored).toEqual(["task-1"]);
  });

  it("a decline restores nothing and comes back as a value", async () => {
    const h = harness({ answer: false });
    await expect(h.port.restoreDelegation("task-1")).resolves.toMatchObject({ ok: false });
    expect(h.restored).toEqual([]);
  });
});

describe("undo_my_edits is scoped to this conversation", () => {
  it("refuses when the only capture predates the session, without asking", async () => {
    const h = harness({
      sessionStartedAt: 5_000,
      snapshots: { [PUBLIC_NOTE]: { id: "old", capturedAt: 1_000 } },
    });
    expect(reasonOf(await h.port.undoMyEdit(PUBLIC_NOTE))).toContain("this conversation");
    expect(h.proposals).toEqual([]);
  });

  it("puts the capture's age in the proposal the human answers", async () => {
    vi.spyOn(Date, "now").mockReturnValue(10_000_000);
    const h = harness({
      sessionStartedAt: 1_000,
      snapshots: { [PUBLIC_NOTE]: { id: "recent", capturedAt: 10_000_000 - 2 * 60_000 } },
    });
    await expect(h.port.undoMyEdit(PUBLIC_NOTE)).resolves.toEqual({ ok: true });
    expect(h.proposals[0]?.detail).toContain("2 minutes ago");
    expect(h.restored).toEqual(["recent"]);
    vi.restoreAllMocks();
  });

  it("refuses a private note before anything else happens", async () => {
    const h = harness({ snapshots: { [PRIVATE_NOTE]: { id: "x", capturedAt: 1 } } });
    await expect(h.port.undoMyEdit(PRIVATE_NOTE)).resolves.toMatchObject({ ok: false });
    expect(h.proposals).toEqual([]);
    expect(h.restored).toEqual([]);
  });
});
