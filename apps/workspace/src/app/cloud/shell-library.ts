// The library as the Mac app holds it: the replica engine over the shell's own SQLite (one file for
// the account in the app's data dir, read and written through the bridge), the device credential
// the shell keeps in the Keychain and hands the page in memory, and the account's files under the
// shell's scheme. Everything the page wrote is on disk the moment the engine queues it, so the Mac
// reads and queues offline, and a quit or a relaunch loses nothing the outbox took.
//
// Its calls go to the cloud's origin across origins (the Worker answers CORS for the app's), each
// carrying the credential and the build, since the Worker meets every install at its build floor.

import { clientBuildValue, CLIENT_BUILD_HEADER } from "@repo/contract/cloud/client-build";
import { mergeBlocks } from "@repo/editor/stale-write";
import { openLibraryReplica } from "@repo/library-replica/library-replica";
import type { ReplicaTransport } from "@repo/library-replica/replica-ports";

import type { KeptCredential, ShellConfig } from "../../shell/shell-config";
import {
  shellConfig,
  shellCredential,
  shellReplicaSql,
  shellStagedBlobs,
} from "../../shell/shell-commands";
import type { LeaveGuard } from "./leave-guard";
import { newId, pageClock } from "./page-library";
import type { PageLibrary } from "./page-library";
import { createCloudWire } from "./v1";

export type ShellOpening =
  | { readonly kind: "ready"; readonly library: PageLibrary }
  // no credential kept: the first run, the sign-in
  | { readonly kind: "signed-out"; readonly config: ShellConfig }
  // the shell's SQLite is older than the library's schema needs, which a build of this app never is
  | { readonly kind: "unsupported" };

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

// the Mac's outbox is on disk, so a quit or a reload loses no change the outbox took: nothing asks
const diskLeaveGuard: LeaveGuard = {
  drop: () => {
    // nothing is armed, so nothing is let go
  },
  hold: () => () => {
    // nothing was held
  },
};

// this Mac leaves its account: the shell lets go of the credential, the replica's file and every
// file of the account, and the page opens again on the sign-in
export const leaveAccount = async (): Promise<void> => {
  await shellCredential.forget();
  window.location.reload();
};

export const openShellLibrary = async (): Promise<ShellOpening> => {
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
    merge: mergeBlocks,
    newId,
    sql: shellReplicaSql(),
    transport,
  });
  if (opening.kind === "unsupported") {
    return { kind: "unsupported" };
  }
  return {
    kind: "ready",
    library: {
      account: { email: kept.email, name: "" },
      cloud: transport,
      fileUrl: (sha) => `${config.filesOrigin}/${sha}`,
      leave: diskLeaveGuard,
      left: leaveAccount,
      replica: opening.replica,
      // a credential the cloud no longer takes (revoked elsewhere, the account deleted) can send
      // nothing more, so the Mac lets it go and asks for a sign-in
      wire: createCloudWire(transport, () => {
        void leaveAccount();
      }),
    },
  };
};
