// Ghost-text state machine — every cancellation edge, with fake hooks: the
// debounce is a captured callback, the request a controllable promise.

import { describe, expect, it } from "vitest";

import { GhostTextMachine, type GhostHooks } from "@repo/app/editor/ai/ghost-text-machine";
import type { GhostTextResult } from "@repo/core/inline-ai";

type Pending = { requestId: string; resolve: (r: GhostTextResult) => void };

function makeHarness(overrides: Partial<GhostHooks> = {}) {
  const state = {
    scheduled: [] as Array<{ fn: () => void; canceled: boolean; fired: boolean }>,
    pending: [] as Pending[],
    canceled: [] as string[],
    shown: [] as string[],
    hidden: 0,
    inserted: [] as string[],
    canTrigger: true,
    prompt: "continue this" as string | null,
  };
  const hooks: GhostHooks = {
    schedule: (fn) => {
      const entry = { fn, canceled: false, fired: false };
      state.scheduled.push(entry);
      return () => {
        entry.canceled = true;
      };
    },
    canTrigger: () => state.canTrigger,
    getPrompt: () => state.prompt,
    request: (_prompt, requestId) =>
      new Promise<GhostTextResult>((resolve) => {
        state.pending.push({ requestId, resolve });
      }),
    cancelRequest: (requestId) => {
      state.canceled.push(requestId);
    },
    show: (text) => {
      state.shown.push(text);
    },
    hide: () => {
      state.hidden += 1;
    },
    insert: (text) => {
      state.inserted.push(text);
    },
    ...overrides,
  };
  const machine = new GhostTextMachine(hooks, 600);
  const fireDebounce = () => {
    const entry = state.scheduled.at(-1);
    if (entry && !entry.canceled) {
      entry.fired = true;
      entry.fn();
    }
  };
  const resolveLast = async (result: GhostTextResult) => {
    state.pending.at(-1)?.resolve(result);
    await Promise.resolve(); // let the .then continuation run
    await Promise.resolve();
  };
  return { machine, state, fireDebounce, resolveLast };
}

describe("ghost-text machine", () => {
  it("doc change → debounce → request → visible", async () => {
    const { machine, state, fireDebounce, resolveLast } = makeHarness();
    machine.onDocChange();
    expect(machine.getPhase()).toBe("scheduled");
    fireDebounce();
    expect(machine.getPhase()).toBe("requesting");
    await resolveLast({ ok: true, text: " and more." });
    expect(machine.getPhase()).toBe("visible");
    expect(state.shown).toEqual([" and more."]);
  });

  it("typing during the debounce re-arms it (no request until a pause)", () => {
    const { machine, state } = makeHarness();
    machine.onDocChange();
    machine.onDocChange();
    machine.onDocChange();
    expect(state.pending).toHaveLength(0);
    expect(state.scheduled.filter((s) => !s.canceled && !s.fired)).toHaveLength(1);
  });

  it("typing during the request cancels it and orphans the response", async () => {
    const { machine, state, fireDebounce, resolveLast } = makeHarness();
    machine.onDocChange();
    fireDebounce();
    machine.onDocChange(); // keystroke while waiting
    expect(state.canceled).toHaveLength(1);
    await resolveLast({ ok: true, text: "stale" });
    expect(state.shown).toHaveLength(0);
  });

  it("caret move cancels without rescheduling", () => {
    const { machine, state, fireDebounce } = makeHarness();
    machine.onDocChange();
    fireDebounce();
    machine.onCaretMove();
    expect(state.canceled).toHaveLength(1);
    expect(machine.getPhase()).toBe("idle");
    expect(state.scheduled.filter((s) => !s.canceled && !s.fired)).toHaveLength(0);
  });

  it("escape dismisses a visible ghost (and consumes the key)", async () => {
    const { machine, state, fireDebounce, resolveLast } = makeHarness();
    machine.onDocChange();
    fireDebounce();
    await resolveLast({ ok: true, text: "ghost" });
    expect(machine.onEscape()).toBe(true);
    expect(state.hidden).toBe(1);
    expect(machine.getPhase()).toBe("idle");
  });

  it("escape mid-request cancels silently (key not consumed)", () => {
    const { machine, state, fireDebounce } = makeHarness();
    machine.onDocChange();
    fireDebounce();
    expect(machine.onEscape()).toBe(false);
    expect(state.canceled).toHaveLength(1);
  });

  it("blur cancels a pending request and hides a visible ghost", async () => {
    const { machine, state, fireDebounce, resolveLast } = makeHarness();
    machine.onDocChange();
    fireDebounce();
    await resolveLast({ ok: true, text: "ghost" });
    machine.onBlur();
    expect(state.hidden).toBe(1);
    expect(machine.getPhase()).toBe("idle");
  });

  it("tab accepts the visible ghost; otherwise falls through", async () => {
    const { machine, state, fireDebounce, resolveLast } = makeHarness();
    expect(machine.onTab()).toBe(false);
    machine.onDocChange();
    fireDebounce();
    await resolveLast({ ok: true, text: " completion." });
    expect(machine.onTab()).toBe(true);
    expect(state.inserted).toEqual([" completion."]);
  });

  it("conditions failing at fire time abort quietly", () => {
    const { machine, state, fireDebounce } = makeHarness();
    state.canTrigger = false;
    machine.onDocChange();
    fireDebounce();
    expect(machine.getPhase()).toBe("idle");
    expect(state.pending).toHaveLength(0);
  });

  it('the "0" sentinel and failures never show a ghost', async () => {
    const { machine, state, fireDebounce, resolveLast } = makeHarness();
    machine.onDocChange();
    fireDebounce();
    await resolveLast({ ok: true, text: "0" });
    expect(machine.getPhase()).toBe("idle");
    machine.onDocChange();
    fireDebounce();
    await resolveLast({ ok: false, error: "nope" });
    expect(machine.getPhase()).toBe("idle");
    expect(state.shown).toHaveLength(0);
  });

  it("a stale response never overwrites a newer ghost", async () => {
    const { machine, state, fireDebounce, resolveLast } = makeHarness();
    machine.onDocChange();
    fireDebounce();
    const stale = state.pending[0];
    machine.onDocChange(); // supersede
    fireDebounce();
    await resolveLast({ ok: true, text: "fresh" });
    stale?.resolve({ ok: true, text: "stale" });
    await Promise.resolve();
    await Promise.resolve();
    expect(state.shown).toEqual(["fresh"]);
  });
});
