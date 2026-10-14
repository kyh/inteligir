import type { SessionPort } from "../sync/sync-runtime";
import type { Fence } from "./phone-db";

export const NOT_SIGNED_IN = "Not signed in.";

// restored: the boot read of a credential whose rows are on disk. signed-in: nothing on disk is
// this sign-in's.
export type SignInSource = "restored" | "signed-in";

// what a reset runs once memory is dropped: a restore reads the rows back for the live session,
// and every other reset wipes them
interface ResetWork {
  wipe: () => Promise<void>;
  hydrate: (sessionId: number) => Promise<void>;
}

// the session's fence and a reset generation: a response from an earlier sign-in, or one the cloud
// has since refused, never lands, and neither does a write started before a sign-out or a
// revocation
export interface SignInFence {
  fenceFor: (sessionId: number) => Fence;
  // null while no sign-in is live
  live: () => Fence | null;
  // every fence made before it falls
  restart: (next: SignInSource | null, work: ResetWork) => void;
  // the last reset's work, which every read and write waits out
  ready: () => Promise<void>;
}

export const createSignInFence = (
  session: Pick<SessionPort, "current" | "fenced">,
): SignInFence => {
  let generation = 0;
  let resetWork: Promise<void> = Promise.resolve();

  const fenceFor = (sessionId: number): Fence => {
    const started = generation;
    return () => session.fenced(sessionId) && generation === started;
  };

  return {
    fenceFor,
    live: () => {
      const current = session.current();
      return current.kind === "live" ? fenceFor(current.id) : null;
    },
    ready: async () => await resetWork,
    restart: (next, work) => {
      generation += 1;
      if (next !== "restored") {
        resetWork = work.wipe();
        return;
      }
      const current = session.current();
      resetWork = current.kind === "live" ? work.hydrate(current.id) : Promise.resolve();
    },
  };
};
