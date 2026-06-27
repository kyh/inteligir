import { create } from "zustand";

import { getBridge } from "@/renderer/lib/bridge";
import type { Delegation } from "@/shared/delegation";

type DelegationStore = {
  delegations: Delegation[];
  /** Fetch the current list + subscribe to live updates. Returns a cleanup. */
  init: () => () => void;
  /** Delegate a checkbox (by its file + item text + nearest heading, which
   * disambiguates duplicate item text). */
  delegate: (
    sourceFile: string,
    text: string,
    heading: string | null,
  ) => Promise<{ ok: boolean; error?: string }>;
  cancel: (id: string) => void;
};

export const useDelegationStore = create<DelegationStore>((set) => ({
  delegations: [],

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
    return bridge.onDelegationsUpdated(({ delegations }) => {
      sawUpdate = true;
      set({ delegations });
    });
  },

  delegate: async (sourceFile, text, heading) => {
    const bridge = getBridge();
    if (!bridge) return { ok: false, error: "Unavailable" };
    const result = await bridge.createDelegation({ sourceFile, text, heading }).catch(() => null);
    if (!result) return { ok: false, error: "Couldn't reach the agent." };
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  },

  cancel: (id) => {
    getBridge()
      ?.cancelDelegation(id)
      .catch(() => {});
  },
}));

/** The most recent delegation for a given checkbox (file + item text + nearest
 * heading), or null. Including the heading keeps status from leaking between two
 * duplicate task labels in different sections. Latest-wins so a re-delegated
 * task reflects its newest run. */
export function findDelegation(
  delegations: Delegation[],
  sourceFile: string,
  text: string,
  heading: string | null,
): Delegation | null {
  const target = text.trim();
  let match: Delegation | null = null;
  for (const d of delegations) {
    if (d.sourceFile === sourceFile && d.anchor.text === target && d.anchor.heading === heading) {
      if (!match || d.createdAt >= match.createdAt) match = d;
    }
  }
  return match;
}
