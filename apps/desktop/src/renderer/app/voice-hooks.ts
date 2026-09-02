// Polled only while a download runs: nothing on the ws bus announces bytes
// landing in the model directory, which is shared across checkouts and is not
// the vault.

import { useQuery } from "@tanstack/react-query";
import { orpc } from "./api";

const DOWNLOAD_POLL_MS = 500;

export function useVoiceStatus() {
  // No explicit `useQuery<…>` generic: it collides with oRPC v2's inference.
  return useQuery({
    ...orpc.voice.status.queryOptions(),
    staleTime: 0,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === "downloading" || state === "preparing" ? DOWNLOAD_POLL_MS : false;
    },
  });
}

export function downloadPercent(receivedBytes: number, sizeBytes: number): number {
  if (sizeBytes <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((receivedBytes / sizeBytes) * 100));
}
