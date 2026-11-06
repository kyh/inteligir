// The platform-free half of the composition root: app-runtime.ts binds it to the Keychain, the
// database, the file folders, the global fetch, React Native's socket, the editor page's merge and
// the OS, so every move between signed in and signed out runs under test, and the scenario suite
// drives it under node against a real Worker.
//
// Signed in, the phone holds the account's library as the replica engine every device runs
// (`@repo/library-replica`) over its own SQLite: every screen reads it offline and every write goes
// through its outbox, sent whenever the cloud can be reached. A sign-in starts the database over,
// since it may hold another account's library; a relaunch opens what it holds, and a database
// emptied meanwhile (the app reinstalled while the Keychain kept its credential) simply pulls the
// library again. A sign-out, a revoked credential and a deleted account wipe the replica and the
// files; a build the cloud no longer takes keeps everything until it is updated.

import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { ClientBuild } from "@repo/contract/cloud/client-build";
import type { V1Client } from "@repo/contract/cloud/v1";
import { createThreadPreviews } from "@repo/agent-panel/thread-previews";
import type { ThreadPreviews } from "@repo/agent-panel/thread-previews";
import { openLibraryReplica } from "@repo/library-replica/library-replica";
import type { LibraryReplica } from "@repo/library-replica/library-replica";
import type {
  BlockMerge,
  NewId,
  ReplicaClock,
  ReplicaSql,
  SocketDial,
} from "@repo/library-replica/replica-ports";
import type { KeptCredential } from "../credential/credential-codec";
import { createFileCache } from "../files/file-cache";
import type { FileCache, FileCachePorts, FileFolders } from "../files/file-cache";
import { createLoginStore } from "../login/login-store";
import type { LoginStore } from "../login/login-store";
import { messageOf } from "./error-message";
import { createExternalStore } from "./external-store";
import type { ReadableStore } from "./external-store";
import { openPhoneTables } from "./phone-db";
import { downloadBlob, phoneTransport, v1ClientOver } from "./phone-transport";

export interface CredentialStore {
  readonly read: () => Promise<KeptCredential | null>;
  readonly write: (credential: KeptCredential) => Promise<void>;
  readonly clear: () => Promise<void>;
}

// the discardable copies of the library's files, past which the least recently drawn go (spec §6:
// about a gigabyte on the phone)
const CACHE_BYTES = 1024 * 1024 * 1024;

export interface ComposeRuntimeArgs {
  readonly cloudUrl: string;
  readonly build: ClientBuild;
  readonly credentials: CredentialStore;
  // the one database, opened once for the app's life
  readonly openSql: () => Promise<ReplicaSql>;
  readonly folders: FileFolders;
  // the global fetch, which every `/v1` call rides
  readonly fetch: (request: Request) => Promise<Response>;
  // null keeps the replica on its check-in alone
  readonly dial: SocketDial | null;
  readonly clock: ReplicaClock;
  readonly newId: NewId;
  // the editor's block merge, which the phone runs in its editor page
  readonly merge: BlockMerge;
  readonly sha256Hex: (bytes: Uint8Array<ArrayBuffer>) => Promise<string>;
  readonly shrinkCover: FileCachePorts["shrink"];
  readonly cacheBytes?: number;
}

// the account's library as this phone holds it, while signed in
export interface PhoneLibrary {
  readonly email: string;
  readonly replica: LibraryReplica;
  // what only the cell answers (the agent, the account), which waits for a connection: the client,
  // and TanStack Query's options over it, one set for the sign-in's link
  readonly client: V1Client;
  readonly queries: ReturnType<typeof createTanstackQueryUtils<V1Client>>;
  readonly files: FileCache;
  // the reply the agent is writing, as the socket carries it
  readonly previews: ThreadPreviews;
}

export type PhoneSession =
  | { readonly kind: "restoring" }
  // `notice`: why this phone is signed out when it did not sign out itself
  | { readonly kind: "signed-out"; readonly notice: string | null }
  | { readonly kind: "signed-in"; readonly library: PhoneLibrary }
  // the cloud no longer takes this build: everything is kept until the app is updated
  | { readonly kind: "outdated" }
  // the library could not open on this phone
  | { readonly kind: "failed"; readonly message: string };

// `unsent`: the phone holds changes the cloud has not taken, which signing out would discard
export type LogoutOutcome =
  | { readonly kind: "signed-out" }
  | { readonly kind: "unsent"; readonly edits: number };

export interface AppRuntime {
  readonly session: ReadableStore<PhoneSession>;
  readonly login: LoginStore;
  // reads the kept credential once and ends `restoring` either way
  readonly start: () => Promise<void>;
  // refuses while changes are unsent, unless told to discard them
  readonly logout: (options?: { readonly discardUnsent?: boolean }) => Promise<LogoutOutcome>;
  // the app is in front again, or back online: a pass runs and the socket dials
  readonly resume: () => void;
  // the app went behind: the socket closes and nothing runs until it resumes
  readonly suspend: () => void;
}

export const SIGNED_OUT_ELSEWHERE = "This iPhone was signed out of your library.";
const ACCOUNT_DELETED = "Your account was deleted, and its library with it.";

// the account's device slot back, best-effort: offline, or a cloud that did not answer, leaves
// the device list naming this phone, to remove
const revokeQuietly = async (library: PhoneLibrary): Promise<void> => {
  try {
    await library.client.account.signOut();
  } catch {
    // nothing to do: the sign-out goes on without it
  }
};

export const composeRuntime = (args: ComposeRuntimeArgs): AppRuntime => {
  const session = createExternalStore<PhoneSession>({ kind: "restoring" });
  let sql: Promise<ReplicaSql> | null = null;
  const database = async (): Promise<ReplicaSql> => {
    sql ??= args.openSql();
    try {
      return await sql;
    } catch (error) {
      sql = null;
      throw error;
    }
  };
  // what the signed-in library stops when it goes: its status watch and its previews
  let release: (() => void) | null = null;

  const transportFor = (credential: string | null) =>
    phoneTransport({ build: args.build, credential, fetch: args.fetch, origin: args.cloudUrl });

  const filesOver = (db: ReplicaSql, credential: string): FileCache => {
    const transport = transportFor(credential);
    return createFileCache({
      capBytes: args.cacheBytes ?? CACHE_BYTES,
      download: async (sha) => await downloadBlob(transport, args.sha256Hex, sha),
      folders: args.folders,
      now: args.clock.now,
      shrink: args.shrinkCover,
      sql: db,
    });
  };

  const replicaOver = async (db: ReplicaSql, files: FileCache, credential: string) => {
    const opening = await openLibraryReplica({
      blobs: files.staged,
      clock: args.clock,
      dial: args.dial,
      merge: args.merge,
      newId: args.newId,
      sql: db,
      transport: transportFor(credential),
    });
    if (opening.kind === "unsupported") {
      throw new Error(
        `This iPhone's SQLite (${opening.sqliteVersion}) is older than your library needs.`,
      );
    }
    return opening.replica;
  };

  // this phone leaves its account: every row, every unsent change and every file go
  const leave = async (library: PhoneLibrary, notice: string | null): Promise<void> => {
    release?.();
    release = null;
    await library.replica.wipe();
    await library.files.clear();
    let said = notice;
    try {
      await args.credentials.clear();
    } catch (error) {
      said = `Signed out, but the saved sign-in could not be removed and may return on the next launch: ${messageOf(error)}`;
    }
    session.set({ kind: "signed-out", notice: said });
  };

  const open = async (kept: KeptCredential, source: "restored" | "signed-in"): Promise<void> => {
    const db = await database();
    let files = filesOver(db, kept.credential);
    let replica = await replicaOver(db, files, kept.credential);
    await openPhoneTables(db);
    if (source === "signed-in") {
      // another account's library, or the last sign-in's, goes before this one's is pulled
      await replica.wipe();
      await files.clear();
      files = filesOver(db, kept.credential);
      replica = await replicaOver(db, files, kept.credential);
    }
    const client = v1ClientOver(transportFor(kept.credential));
    const library: PhoneLibrary = {
      client,
      email: kept.email,
      files,
      previews: createThreadPreviews(replica.onThreadFrame),
      queries: createTanstackQueryUtils(client),
      replica,
    };
    const unwatch = replica.onStatus(() => {
      const { failure } = replica.status();
      if (failure?.kind !== "session" || session.get().kind !== "signed-in") {
        return;
      }
      if (failure.end === "outdated") {
        release?.();
        release = null;
        session.set({ kind: "outdated" });
        return;
      }
      void leave(library, failure.end === "gone" ? ACCOUNT_DELETED : SIGNED_OUT_ELSEWHERE);
    });
    release = () => {
      unwatch();
      library.previews.stop();
    };
    session.set({ kind: "signed-in", library });
    replica.start();
    void (async () => {
      try {
        await files.sweep();
      } catch {
        // a sweep is tidying; the next launch sweeps again
      }
    })();
  };

  const login = createLoginStore({
    client: (credential) => v1ClientOver(transportFor(credential)),
    keep: args.credentials.write,
    signedIn: async (kept) => {
      await open(kept, "signed-in");
    },
  });

  let started = false;

  const signedIn = (): PhoneLibrary | null => {
    const current = session.get();
    return current.kind === "signed-in" ? current.library : null;
  };

  return {
    async logout(options = {}) {
      const library = signedIn();
      if (library === null) {
        return { kind: "signed-out" };
      }
      const { unsent } = library.replica.status();
      if (unsent > 0 && options.discardUnsent !== true) {
        return { edits: unsent, kind: "unsent" };
      }
      // never waited on, so an unreachable cloud holds no sign-out open
      void revokeQuietly(library);
      await leave(library, null);
      return { kind: "signed-out" };
    },
    login,
    resume() {
      signedIn()?.replica.resume();
    },
    session,
    async start() {
      if (started) {
        return;
      }
      started = true;
      let kept: KeptCredential | null = null;
      try {
        kept = await args.credentials.read();
      } catch (error) {
        login.fail(`The saved sign-in could not be read: ${messageOf(error)}`);
      }
      if (kept === null) {
        session.set({ kind: "signed-out", notice: null });
        return;
      }
      try {
        await open(kept, "restored");
      } catch (error) {
        session.set({ kind: "failed", message: messageOf(error) });
      }
    },
    suspend() {
      signedIn()?.replica.suspend();
    },
  };
};
