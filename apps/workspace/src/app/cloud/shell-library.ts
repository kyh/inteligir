// The library as the Mac app holds it: the replica engine over the shell's own SQLite (one file for
// the account in the app's data dir, read and written through the bridge), the device credential
// the shell keeps in the Keychain and hands the page in memory, and the account's files under the
// shell's scheme. Everything the page wrote is on disk the moment the engine queues it, so the Mac
// reads and queues offline, and a quit or a relaunch loses nothing the outbox took; what the page
// still holds (the open item's edit, waiting out its pause) it writes when the shell asks before a
// quit.
//
// Its calls go to the cloud's origin across origins (the Worker answers CORS for the app's), each
// carrying the credential and the build, since the Worker meets every install at its build floor.

import { clientBuildValue, CLIENT_BUILD_HEADER } from "@repo/contract/cloud/client-build";
import { toast } from "@repo/ui/components/sonner";
import { replicaMerge } from "@repo/editor/stale-write";
import type { SessionEnd } from "@repo/library-replica/call-outcome";
import { openLibraryReplica } from "@repo/library-replica/library-replica";
import type { ReplicaTransport } from "@repo/library-replica/replica-ports";

import type { KeptCredential, ShellConfig } from "../../shell/shell-config";
import {
  shellConfig,
  shellCredential,
  shellLeaving,
  shellReplicaSql,
  shellStagedBlobs,
} from "../../shell/shell-commands";
import type { Held, LeaveGuard } from "./leave-guard";
import { fileAt, newId, pageClock } from "./page-library";
import type { PageLibrary } from "./page-library";
import { signOutTroubleText } from "./shell-trouble";
import { createCloudWire, watchSessionEnd } from "./v1";

const OUTDATED =
  "This version of Inteligir is too old for your library. It updates itself when you quit, and what you change here waits until then.";

export type ShellOpening =
  | { readonly kind: "ready"; readonly library: PageLibrary }
  // no credential kept: the first run, the sign-in
  | { readonly kind: "signed-out"; readonly config: ShellConfig };

// `/v1` as this Mac reaches it: the cloud's origin, the build on every request, and the credential
// once a sign-in kept one
export const macTransport = (config: ShellConfig, credential: string | null): ReplicaTransport => ({
  fetch: async (request) => {
    const headers = new Headers(request.headers);
    headers.set(
      CLIENT_BUILD_HEADER,
      clientBuildValue({ platform: "desktop", version: config.version }),
    );
    if (credential !== null) {
      headers.set("authorization", `Bearer ${credential}`);
    }
    return await fetch(new Request(request, { headers }));
  },
  origin: config.cloudOrigin,
});

// The Mac's outbox is on disk, so nothing asks before the page goes; what a holder keeps in memory
// it writes when the shell says it is about to quit or restart, and the page answers once all of
// it is written, or once it failed, since the shell goes after a moment either way. Made before
// anything else opens, so a quit from the sign-in, or from a library that would not open, is
// answered at once.
export const createShellLeaveGuard = (): LeaveGuard => {
  const holders = new Set<Held>();
  shellLeaving.onLeaving(() => {
    void (async () => {
      await Promise.allSettled([...holders].map(async (held) => await held.write?.()));
      await shellLeaving.ready();
    })();
  });
  return {
    drop: () => {
      // nothing is armed, so nothing is let go
    },
    hold: (held) => {
      holders.add(held);
      return () => {
        holders.delete(held);
      };
    },
  };
};

// this Mac leaves its account: the shell lets go of the credential, the replica's file and every
// file of the account, and the page opens again on the sign-in. A sign-out, the replica and every
// wire call may each ask, and share the one leaving; only one that failed goes again
const leaveAccount = (reload: () => void): (() => Promise<void>) => {
  let leaving: Promise<void> | null = null;
  const leave = async (): Promise<void> => {
    try {
      await shellCredential.forget();
    } catch (error) {
      leaving = null;
      throw error;
    }
    reload();
  };
  return async () => {
    leaving ??= leave();
    await leaving;
  };
};

// `reload` opens the page again from the start: the library, or the sign-in once signed out
export const openShellLibrary = async (
  leave: LeaveGuard,
  reload: () => void,
): Promise<ShellOpening> => {
  const config = await shellConfig();
  const kept: KeptCredential | null = await shellCredential.restore();
  if (kept === null) {
    return { config, kind: "signed-out" };
  }
  const transport = macTransport(config, kept.credential);
  const opening = await openLibraryReplica({
    blobs: shellStagedBlobs(),
    clock: pageClock,
    dial: (url) => new WebSocket(url),
    merge: replicaMerge,
    newId,
    sql: shellReplicaSql(),
    transport,
  });
  // the shell compiles its SQLite in, so no build meets this; if one did, the window says it failed
  if (opening.kind === "unsupported") {
    throw new Error(`the shell's SQLite is ${opening.sqliteVersion}`);
  }
  const left = leaveAccount(reload);
  // a credential the cloud no longer takes (revoked elsewhere, the account deleted) can send
  // nothing more, so the Mac lets it go and asks for a sign-in; a shell that could not let it go
  // says why and stays, since a reload would open on the credential it still keeps. Below the
  // build floor the credential stands, so the replica and its outbox wait on disk for the update
  const sessionEnded = (end: SessionEnd): void => {
    if (end === "outdated") {
      toast.error(OUTDATED, { id: "outdated" });
      return;
    }
    void (async () => {
      try {
        await left();
      } catch (error) {
        toast.error(signOutTroubleText(error), { id: "leave-account" });
      }
    })();
  };
  watchSessionEnd(opening.replica, sessionEnded);
  return {
    kind: "ready",
    library: {
      account: { email: kept.email, name: "" },
      cloud: transport,
      fileUrl: (sha) => `${config.filesOrigin}/${sha}`,
      leave,
      // the shell's scheme answers a file from its staged files, its cache or the cloud
      readFile: async (sha) =>
        await fileAt(`${config.filesOrigin}/${sha}`, async (request) => await fetch(request)),
      left,
      replica: opening.replica,
      wire: createCloudWire(transport, sessionEnded),
    },
  };
};
