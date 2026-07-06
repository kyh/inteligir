// ---------------------------------------------------------------------------
// Host notifier composition — the plain callbacks the composition root
// (host-context.ts, driven by create-host.ts) builds ONCE and installs here,
// so the pieces that fire them (the delegation manager, inline-AI) receive them
// at construction / call time without importing the IPC event registry
// themselves. Keeping the registry out of the low-level pieces is the whole
// point: they get a plain `(…) => void`, not `emitEvent`.
//
// This is also the survives-a-logout seam. resetX() tears an individual
// singleton down and the next getX() rebuilds it lazily; this holder is NOT
// reset, so a manager rebuilt after a logout re-reads the same notifiers here.
// A dedicated leaf module (no manager imports) so the pieces that read it never
// form an import cycle with the graph that composes it.
// ---------------------------------------------------------------------------

import type { StoreRecoveryEvent } from "./lib/json-store";
import type { Delegation } from "@repo/features/delegation";

/** The five host notifier slots, composed by the host and fired by the graph.
 * Each is a plain callback that fans into `emitEvent(...)` / the notifications
 * manager — that wiring lives in the composition root, not here. */
export type HostNotifiers = {
  /** A JsonStore quarantined a data file (json-store's default recovery seam). */
  storeRecovery: (event: StoreRecoveryEvent) => void;
  /** A vault file changed on disk (watcher broadcast → onVaultChanged + reindex). */
  vaultChange: (root: string) => void;
  /** The delegation list changed (drives inline badges). */
  delegationsChanged: (delegations: Delegation[]) => void;
  /** A delegation's live transcript advanced (drives the response dock). */
  delegationStream: (id: string, text: string) => void;
  /** Inline-AI generation streamed a text delta (drives live insertion). */
  inlineAiStream: (requestId: string, delta: string) => void;
};

let notifiers: HostNotifiers | null = null;

/** Install the composed notifier bundle. Called once by the composition root
 * (buildHostContext), before any piece that reads it is constructed. */
export function installHostNotifiers(next: HostNotifiers): void {
  notifiers = next;
}

/** The installed notifier bundle, or null before composition (and in unit tests,
 * which construct managers directly and expect the no-notifier default). */
export function getHostNotifiers(): HostNotifiers | null {
  return notifiers;
}
