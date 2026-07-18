import { create } from "zustand";

import { getBridge } from "@renderer/lib/bridge";
import type { Delegation } from "@repo/features/delegation";

type DelegationStore = {
  delegations: Delegation[];
  /** Accumulating response text per running/finished delegation id (live). */
  streams: Record<string, string>;
  /** Fetch the current list + subscribe to live updates. Returns a cleanup. */
  init: () => () => void;
  /** Delegate a checkbox by its file + ordinal (position among all checkboxes
   * in the document). */
  delegate: (
    sourceFile: string,
    index: number,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  cancel: (id: string) => void;
  /** Overwrite the delegation's file with its pre-run snapshot (cheap undo of
   * the agent's edit). The vault watcher refreshes the open editor. */
  restore: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>;
};

export const useDelegationStore = create<DelegationStore>((set) => ({
  delegations: [],
  streams: {},

  init: () => {
    const bridge = getBridge();
    if (!bridge) return () => {};
    // A live update can land before the initial list resolves; once it has, the
    // (now-stale) list response must not clobber the fresher state.
    let sawUpdate = false;
    void bridge
      .listDelegations()
      .then(({ delegations }) => {
        if (!sawUpdate) set({ delegations });
        return undefined;
      })
      .catch(() => {});
    const offUpdated = bridge.onDelegationsUpdated(({ delegations }) => {
      sawUpdate = true;
      set({ delegations });
    });
    const offStreamed = bridge.onDelegationStreamed(({ id, text }) =>
      set((s) => ({ streams: { ...s.streams, [id]: text } })),
    );
    return () => {
      offUpdated();
      offStreamed();
    };
  },

  delegate: async (sourceFile, index) => {
    const bridge = getBridge();
    if (!bridge) return { ok: false, error: "Unavailable" };
    const result = await bridge.createDelegation({ sourceFile, index }).catch(() => null);
    if (!result) return { ok: false, error: "Couldn't reach the agent." };
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  },

  cancel: (id) => {
    getBridge()
      ?.cancelDelegation(id)
      .catch(() => {});
  },

  restore: async (id) => {
    const bridge = getBridge();
    if (!bridge) return { ok: false, error: "Unavailable" };
    const result = await bridge.restoreDelegationSnapshot(id).catch(() => null);
    if (!result) return { ok: false, error: "Couldn't restore the snapshot." };
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  },
}));

/** The most recent delegation for a given checkbox (file + ordinal), or null.
 * The ordinal is unique per checkbox, so status never leaks between duplicate
 * labels. Latest-wins so a re-delegated task reflects its newest run. */
export function findDelegation(
  delegations: Delegation[],
  sourceFile: string,
  index: number,
): Delegation | null {
  let match: Delegation | null = null;
  for (const d of delegations) {
    if (d.sourceFile === sourceFile && d.anchor.index === index) {
      if (!match || d.createdAt >= match.createdAt) match = d;
    }
  }
  return match;
}
