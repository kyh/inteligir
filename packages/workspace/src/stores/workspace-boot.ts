import { getBridge } from "@repo/bridge/client";
import type { Bridge } from "@repo/bridge/ipc-contract";
import type { WorkspaceBoot } from "@repo/bridge/vault";

// ---------------------------------------------------------------------------
// The workspace's ONE boot invoke.
//
// The listing, the persisted ui state and the open note's bytes have two
// independent readers (the vault provider and the ui-state mirror) and one
// answer, so the call is shared rather than duplicated: a cold open costs one
// round trip between a signed-in page and the object that holds all three,
// not one per reader.
//
// Keyed on the BRIDGE, because that is what "one boot" is scoped to: a
// different Bridge is a different session, with its own vault to describe.
//
// A REJECTION is never kept. The socket's supervisor reconnects, and a promise
// that failed once during a hiccup would otherwise be the permanent answer to
// "what is in this vault?".
// ---------------------------------------------------------------------------

const boots = new WeakMap<Bridge, Promise<WorkspaceBoot>>();

export function workspaceBoot(): Promise<WorkspaceBoot> {
  const bridge = getBridge();
  const existing = boots.get(bridge);
  if (existing !== undefined) return existing;
  const pending = bridge.getWorkspaceBoot().catch((error: unknown) => {
    boots.delete(bridge);
    throw error;
  });
  boots.set(bridge, pending);
  return pending;
}
