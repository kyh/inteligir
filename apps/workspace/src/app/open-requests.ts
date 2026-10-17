// A surface drawn over the workspace (Settings) cannot reach the workspace's own verbs, and the
// workspace reads `?item=` only at boot: so it leaves the item to open here, and the workspace,
// which stays mounted under it, opens it. One request at a time; a later one replaces it.

import { createStore } from "zustand/vanilla";

interface OpenRequest {
  readonly path: string;
  readonly nonce: number;
}

const requests = createStore<OpenRequest | null>()(() => null);

export const requestOpenItem = (path: string): void => {
  requests.setState((current) => ({ nonce: (current?.nonce ?? 0) + 1, path }), true);
};

// the workspace's side: each request once, in the order made
export const subscribeOpenRequests = (open: (path: string) => void): (() => void) =>
  requests.subscribe((request) => {
    if (request !== null) {
      open(request.path);
    }
  });
