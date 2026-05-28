import { create } from "zustand";

import { getBridge } from "@/renderer/lib/bridge";
import type { Artifact } from "@/shared/artifacts";

// Singleton artifacts store backed by one bridge subscription. Initialized
// lazily by PanelGrid on mount; the subscription lives for the session.

type ArtifactsState = {
  artifacts: Artifact[];
  loading: boolean;
};

export const useArtifactsStore = create<ArtifactsState>(() => ({
  artifacts: [],
  loading: true,
}));

let initialized = false;

export function initArtifacts(): void {
  if (initialized) return;
  const bridge = getBridge();
  if (!bridge) return;
  initialized = true;
  let broadcastSeen = false;
  bridge.onArtifactsUpdated((list) => {
    broadcastSeen = true;
    applyArtifacts(list.artifacts);
  });
  bridge
    .listArtifacts()
    .then((list) => {
      // Skip the stale read if a broadcast with newer data has already
      // landed between subscribe and the IPC response.
      if (broadcastSeen) return null;
      applyArtifacts(list.artifacts);
      return null;
    })
    .catch(() => {
      // Clear loading on failure so the library panel doesn't sit on a
      // perpetual placeholder. Broadcasts still update artifacts later.
      if (!broadcastSeen) useArtifactsStore.setState({ loading: false });
    });
}

/**
 * Apply a new artifact list to the store, but skip the setState (and the
 * cascade of selector-driven re-renders + sort/memo work it triggers) when
 * the list is identical to the current one. The echo broadcast that follows
 * every patchArtifactState call would otherwise force a library re-render
 * on every keystroke in any open viewer.
 */
function applyArtifacts(next: Artifact[]): void {
  const current = useArtifactsStore.getState();
  if (!current.loading && sameArtifactList(current.artifacts, next)) return;
  useArtifactsStore.setState({ artifacts: next, loading: false });
}

function sameArtifactList(a: Artifact[], b: Artifact[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.id !== y.id || x.updatedAt !== y.updatedAt) return false;
  }
  return true;
}
