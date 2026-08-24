// Whether this machine can dictate, as a query both the composer and Settings
// read.
//
// POLLED, AND ONLY WHILE A DOWNLOAD IS RUNNING. Nothing on the ws bus
// announces a byte landing in the model directory — that directory is shared
// across every checkout on the machine and is not the vault, so no change kind
// covers it, and inventing one would put a family on the bus that no server
// write ever announces. The rest of the time this is a fact that changes only
// when someone presses a button, so the query is re-read on mount and left
// alone.

import type { VoiceStatusResponse } from "@repo/api/local/voice/voice-schema";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "./api";

/** Fast enough that a 32 MB download's bar moves, slow enough that the poll
 *  costs nothing beside the transfer itself. */
const DOWNLOAD_POLL_MS = 500;

export function useVoiceStatus() {
  return useQuery<VoiceStatusResponse>({
    ...orpc.voice.status.queryOptions(),
    staleTime: 0,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === "downloading" || state === "preparing" ? DOWNLOAD_POLL_MS : false;
    },
  });
}

/** How far the download has got, as a whole percent — one derivation, so the
 *  bar and the sentence beside it cannot round differently. */
export function downloadPercent(receivedBytes: number, sizeBytes: number): number {
  if (sizeBytes <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((receivedBytes / sizeBytes) * 100));
}
