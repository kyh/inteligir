// The undo-toast collection protocol — first capture per path wins (its
// bytes are the pre-turn state), one presentation per settled turn, nothing
// presented for a turn that wrote nothing.

import { describe, expect, it } from "vitest";

import type { AppAgentEvent } from "@repo/bridge/agent-events";
import type { AgentEditCaptured } from "@repo/bridge/ipc-registry";

import {
  connectAgentEditUndo,
  describeAgentEdits,
  runAgentEditUndo,
} from "@renderer/workspace/agent-edit-undo";

function harness() {
  const capturedListeners = new Set<(event: AgentEditCaptured) => void>();
  const agentListeners = new Set<(event: AppAgentEvent) => void>();
  const presented: AgentEditCaptured[][] = [];
  const dispose = connectAgentEditUndo({
    subscribeCaptured: (listener) => {
      capturedListeners.add(listener);
      return () => capturedListeners.delete(listener);
    },
    subscribeAgentEvents: (listener) => {
      agentListeners.add(listener);
      return () => agentListeners.delete(listener);
    },
    present: (edits) => presented.push(edits),
  });
  let seq = 0;
  return {
    dispose,
    presented,
    capture: (path: string, kind: "edit" | "create" = "edit") => {
      const event: AgentEditCaptured = { id: `cp-${seq++}`, path, kind, capturedAt: seq };
      for (const listener of capturedListeners) listener(event);
      return event;
    },
    endTurn: () => {
      for (const listener of agentListeners) listener({ type: "agent_end" });
    },
    listenerCount: () => capturedListeners.size + agentListeners.size,
  };
}

describe("connectAgentEditUndo", () => {
  it("presents a settled turn's edits — FIRST capture per path wins", () => {
    const h = harness();
    const first = h.capture("notes/a.md");
    h.capture("notes/a.md"); // mid-turn re-edit — not the undo point
    const other = h.capture("notes/b.md");
    h.endTurn();

    expect(h.presented).toEqual([[first, other]]);
  });

  it("a create followed by edits of the same file undoes to the create (deletion)", () => {
    const h = harness();
    const created = h.capture("fresh.md", "create");
    h.capture("fresh.md", "edit");
    h.endTurn();

    expect(h.presented).toEqual([[created]]);
  });

  it("presents nothing for a turn with no captures, and resets between turns", () => {
    const h = harness();
    h.endTurn();
    expect(h.presented).toEqual([]);

    const a = h.capture("a.md");
    h.endTurn();
    const b = h.capture("b.md");
    h.endTurn();

    // Two separate presentations; the second turn does NOT re-offer a.md.
    expect(h.presented).toEqual([[a], [b]]);
  });

  it("dispose unsubscribes both channels", () => {
    const h = harness();
    h.dispose();
    expect(h.listenerCount()).toBe(0);
  });
});

const makeEdit = (
  path: string,
  overrides?: Partial<Pick<AgentEditCaptured, "id" | "kind">>,
): AgentEditCaptured => ({
  id: "x",
  path,
  kind: "edit",
  capturedAt: 0,
  ...overrides,
});

describe("describeAgentEdits", () => {
  it("names a single file, distinguishing created from edited", () => {
    expect(describeAgentEdits([makeEdit("notes/plan.md")])).toBe('Agent edited "plan.md"');
    expect(describeAgentEdits([makeEdit("plan.md", { kind: "create" })])).toBe(
      'Agent created "plan.md"',
    );
  });

  it("summarizes several files", () => {
    expect(describeAgentEdits([makeEdit("a.md"), makeEdit("b.md"), makeEdit("c.md")])).toBe(
      "Agent edited 3 notes",
    );
  });
});

describe("runAgentEditUndo — flush-first open-note coherence", () => {
  it("flushes the open note BEFORE restoring — the buffer must be clean when the write lands", async () => {
    const order: string[] = [];
    const result = await runAgentEditUndo(
      [makeEdit("a.md", { id: "cp-1" }), makeEdit("b.md", { id: "cp-2" })],
      {
        flushOpenNote: async () => {
          order.push("flush");
          return true;
        },
        restore: async (ids) => {
          order.push(`restore:${ids.join(",")}`);
          return { ok: true };
        },
      },
    );
    expect(order).toEqual(["flush", "restore:cp-1,cp-2"]);
    expect(result).toEqual({ ok: true });
  });

  it("still restores after a failed flush — the restore is the user's explicit intent", async () => {
    let restored = false;
    const result = await runAgentEditUndo([makeEdit("a.md", { id: "cp-1" })], {
      flushOpenNote: async () => false,
      restore: async () => {
        restored = true;
        return { ok: true };
      },
    });
    expect(restored).toBe(true);
    expect(result).toEqual({ ok: true });
  });

  it("maps a rejected restore into an error VALUE for the toast", async () => {
    const result = await runAgentEditUndo([makeEdit("a.md", { id: "cp-1" })], {
      flushOpenNote: async () => true,
      restore: async () => {
        throw new Error("bridge went away");
      },
    });
    expect(result).toEqual({ ok: false, error: "bridge went away" });
  });
});
