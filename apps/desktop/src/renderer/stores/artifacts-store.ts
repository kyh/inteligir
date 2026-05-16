// ---------------------------------------------------------------------------
// Singleton artifacts store. One subscription to the bridge feeds every
// consumer (ChatPage's open-panel map, ArtifactsPanel's library list).
// Without this, each component was independently subscribing to
// onArtifactsUpdated + calling listArtifacts and running its own
// broadcast-vs-stale-read guard.
//
// Initialized lazily on first init() call — chat-page invokes it at the
// top of the tree. The subscription lives for the session; we never tear
// it down because the bridge is window-scoped.
// ---------------------------------------------------------------------------

import { create } from "zustand";

import { getBridge } from "@/renderer/lib/bridge";
import type { Artifact } from "@/shared/artifacts";

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
    useArtifactsStore.setState({ artifacts: list.artifacts, loading: false });
  });
  bridge
    .listArtifacts()
    .then((list) => {
      // Skip the stale read if a broadcast with newer data has already
      // landed between subscribe and the IPC response.
      if (broadcastSeen) return null;
      useArtifactsStore.setState({ artifacts: list.artifacts, loading: false });
      return null;
    })
    .catch(() => null);
}
