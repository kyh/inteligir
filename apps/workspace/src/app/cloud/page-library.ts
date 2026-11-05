// The library as this page holds it, whichever host serves the page: the replica engine every
// device runs (`@repo/library-replica`), the wire to the cell, the account, and what the host
// decides (where a file is drawn from, how `/v1` is reached for bytes, where a sign-out goes).
//
// The browser tab's: SQLite's own wasm in memory, with the session cookie for its credential. The
// tab keeps nothing between loads: it pulls the library again each time it opens, and a write it
// queued goes once the cell answers, so the tab is online only (spec §6, "Web"). The Mac's is the
// shell's (`shell-library.ts`).

import { V1_BLOBS_PATH } from "@repo/contract/cloud/library/library-blobs";
import { mergeBlocks } from "@repo/editor/stale-write";
import { openLibraryReplica } from "@repo/library-replica/library-replica";
import type { LibraryReplica } from "@repo/library-replica/library-replica";
import { openMemorySql } from "@repo/library-replica/memory-sql";
import type {
  ReplicaClock,
  ReplicaTransport,
  StagedBlobs,
} from "@repo/library-replica/replica-ports";
import { uuidV7 } from "@repo/notes/library/uuid-v7";
import { z } from "zod";

import type { LeaveGuard } from "./leave-guard";
import { createCloudWire } from "./v1";
import type { CloudWire } from "./v1";

// who is signed in: Settings › Account names them
export interface SignedIn {
  readonly email: string;
  readonly name: string;
}

// why this device leaves its account: a sign-out, or the account deleted
export type LeaveReason = "signed-out" | "deleted";

export interface PageLibrary {
  readonly replica: LibraryReplica;
  readonly wire: CloudWire;
  readonly account: SignedIn;
  // what asks before the page leaves while a change it holds has not reached the cell
  readonly leave: LeaveGuard;
  // where a file of the library is drawn from: the cloud's own route in the tab, the shell's
  // scheme on the Mac
  readonly fileUrl: (sha: string) => string;
  // `/v1` for the bytes the wire does not carry: a file uploaded for an import, an export saved
  readonly cloud: ReplicaTransport;
  // this device has left its account, its replica already wiped: the host's next screen
  readonly left: (reason: LeaveReason) => Promise<void>;
}

export type PageOpening =
  | { readonly kind: "ready"; readonly library: PageLibrary }
  // no session: the site's sign-in, which comes back to where the page was opened
  | { readonly kind: "signed-out" }
  // the browser's SQLite is older than the library's schema needs
  | { readonly kind: "unsupported" };

// Better Auth's own answer for the cookie this request carries: null when it names no session
const sessionSchema = z
  .object({ user: z.object({ email: z.string(), name: z.string() }) })
  .nullable();

const SIGN_IN_PATH = "/app/sign-in";

// the site's sign-in, told to load this page again once it signs the browser in
export const signInHref = (here: Pick<Location, "pathname" | "search">): string =>
  `${SIGN_IN_PATH}?${new URLSearchParams({ next: `${here.pathname}${here.search}` }).toString()}`;

export const pageClock: ReplicaClock = {
  after: (ms, run) => {
    const timer = setTimeout(run, ms);
    return () => {
      clearTimeout(timer);
    };
  },
  now: () => Date.now(),
};

export const newId = (): string => uuidV7(Date.now(), crypto.getRandomValues(new Uint8Array(16)));

// a file waiting for the write that names it to land: in memory, as the rows are, so a reload
// takes it with the write it waited for
const memoryStagedBlobs = (): StagedBlobs => {
  const held = new Map<string, Uint8Array<ArrayBuffer>>();
  return {
    clear: async () => {
      held.clear();
      await Promise.resolve();
    },
    put: async (sha, bytes) => {
      held.set(sha, bytes);
      await Promise.resolve();
    },
    read: async (sha) => await Promise.resolve(held.get(sha) ?? null),
    remove: async (sha) => {
      held.delete(sha);
      await Promise.resolve();
    },
  };
};

const readSession = async (origin: string): Promise<SignedIn | null> => {
  const response = await fetch(`${origin}/api/auth/get-session`, { credentials: "same-origin" });
  if (!response.ok) {
    return null;
  }
  return sessionSchema.parse(await response.json())?.user ?? null;
};

export const openPageLibrary = async (
  origin: string,
  { leave, onSessionEnd }: { leave: LeaveGuard; onSessionEnd: () => void },
): Promise<PageOpening> => {
  const account = await readSession(origin);
  if (account === null) {
    return { kind: "signed-out" };
  }
  const transport: ReplicaTransport = { fetch: async (request) => await fetch(request), origin };
  const opening = await openLibraryReplica({
    blobs: memoryStagedBlobs(),
    clock: pageClock,
    dial: (url) => new WebSocket(url),
    merge: mergeBlocks,
    newId,
    sql: await openMemorySql(),
    transport,
  });
  if (opening.kind === "unsupported") {
    return { kind: "unsupported" };
  }
  return {
    kind: "ready",
    library: {
      account,
      cloud: transport,
      fileUrl: (sha) => `${V1_BLOBS_PATH}/${sha}`,
      leave,
      left: async (reason) => {
        leave.drop();
        window.location.assign(reason === "deleted" ? "/" : SIGN_IN_PATH);
        await Promise.resolve();
      },
      replica: opening.replica,
      wire: createCloudWire(transport, onSessionEnd),
    },
  };
};
