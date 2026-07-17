// The undo-toast collection protocol — first capture per path wins (its
// bytes are the pre-turn state), one presentation per settled turn, nothing
// presented for a turn that wrote nothing.

import { describe, expect, it } from "vitest";

import type { AppAgentEvent } from "@repo/features/agent-events";
import type { AgentEditCaptured } from "@repo/features/ipc-registry";

import { connectAgentEditUndo, describeAgentEdits } from "@renderer/workspace/agent-edit-undo";

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

describe("describeAgentEdits", () => {
  const edit = (path: string, kind: "edit" | "create" = "edit"): AgentEditCaptured => ({
    id: "x",
    path,
    kind,
    capturedAt: 0,
  });

  it("names a single file, distinguishing created from edited", () => {
    expect(describeAgentEdits([edit("notes/plan.md")])).toBe('Agent edited "plan.md"');
    expect(describeAgentEdits([edit("plan.md", "create")])).toBe('Agent created "plan.md"');
  });

  it("summarizes several files", () => {
    expect(describeAgentEdits([edit("a.md"), edit("b.md"), edit("c.md")])).toBe(
      "Agent edited 3 notes",
    );
  });
});
