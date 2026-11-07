// The library as this page holds it, whichever host serves the page: the replica engine every
// device runs (`@repo/library-replica`), the wire to the cell, the account, and what the host
// decides (where a file is drawn from, how `/v1` is reached for bytes, where a sign-out goes).
//
// The browser tab's: SQLite's own wasm in memory, with the session cookie for its credential. The
// tab keeps nothing between loads: it pulls the library again each time it opens, and a write it
// queued goes once the cell answers, so the tab is online only (spec §6, "Web"). The Mac's is the
// shell's (`shell-library.ts`).

import { V1_BLOBS_PATH } from "@repo/contract/cloud/library/library-blobs";
import { replicaMerge } from "@repo/editor/stale-write";
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
import { createCloudWire, watchSessionEnd } from "./v1";
import type { CloudWire } from "./v1";

// who is signed in: Settings › Account names them
export interface SignedIn {
  readonly email: string;
  readonly name: string;
}

// why this device leaves its account: a sign-out, or the account deleted
type LeaveReason = "signed-out" | "deleted";

export interface PageLibrary {
  readonly replica: LibraryReplica;
  readonly wire: CloudWire;
  readonly account: SignedIn;
  // what asks before the page leaves while a change it holds has not reached the cell
  readonly leave: LeaveGuard;
  // where a file of the library is drawn from: the cloud's own route in the tab, the shell's
  // scheme on the Mac
  readonly fileUrl: (sha: string) => string;
  // a file's bytes from there, a file this device has not sent up yet among them, as the editor
  // draws a picture in a note; rejects while no copy of it can be had
  readonly readFile: (sha: string) => Promise<Blob>;
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
// takes it with the write it waited for; the page draws it from here until then
const memoryStagedBlobs = (): StagedBlobs & { readonly file: (sha: string) => Blob | null } => {
  const held = new Map<string, Blob>();
  return {
    clear: async () => {
      held.clear();
      await Promise.resolve();
    },
    file: (sha) => held.get(sha) ?? null,
    put: async (sha, bytes, mime) => {
      held.set(sha, new Blob([bytes], { type: mime }));
      await Promise.resolve();
    },
    read: async (sha) => {
      const file = held.get(sha);
      return file === undefined ? null : new Uint8Array(await file.arrayBuffer());
    },
    remove: async (sha) => {
      held.delete(sha);
      await Promise.resolve();
    },
  };
};

// where the tab draws a file of the library from: the cloud's own route, under its cookie
const fileUrl = (sha: string): string => `${V1_BLOBS_PATH}/${sha}`;

// a file of the library as `url` answers it, read whole
export const fileAt = async (
  url: string,
  fetchFile: (request: Request) => Promise<Response>,
): Promise<Blob> => {
  const response = await fetchFile(new Request(url));
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`the file answered ${String(response.status)}`);
  }
  return await response.blob();
};

// who this cookie signs in, or null when the site says no one; a fault of the site's says neither,
// so it rejects rather than send a signed-in person to sign in again
const readSession = async (origin: string): Promise<SignedIn | null> => {
  const response = await fetch(`${origin}/api/auth/get-session`, { credentials: "same-origin" });
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`the session read answered ${String(response.status)}`);
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
  const staged = memoryStagedBlobs();
  const opening = await openLibraryReplica({
    blobs: staged,
    clock: pageClock,
    dial: (url) => new WebSocket(url),
    merge: replicaMerge,
    newId,
    sql: await openMemorySql(),
    transport,
  });
  if (opening.kind === "unsupported") {
    return { kind: "unsupported" };
  }
  // the tab names no build, so the floor never refuses it: every end it meets is a sign-in's
  watchSessionEnd(opening.replica, onSessionEnd);
  return {
    kind: "ready",
    library: {
      account,
      cloud: transport,
      fileUrl,
      leave,
      left: async (reason) => {
        leave.drop();
        window.location.assign(reason === "deleted" ? "/" : SIGN_IN_PATH);
        await Promise.resolve();
      },
      // the file this tab has not sent up yet, else the cloud's, which the browser keeps as long
      // as the cloud says a file under its sha never changes
      readFile: async (sha) =>
        staged.file(sha) ?? (await fileAt(`${origin}${fileUrl(sha)}`, transport.fetch)),
      replica: opening.replica,
      wire: createCloudWire(transport, onSessionEnd),
    },
  };
};
