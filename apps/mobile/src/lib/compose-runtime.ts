// The platform-free half of the composition root: app-runtime.ts binds it to Better Auth's Expo
// client, the phone's key-value store, its file folder, the global fetch, React Native's socket and
// the OS, so every move between signed in and signed out runs under test.
//
// Signed in, the phone reads the account's library from the cloud through TanStack Query, whose
// cache the app keeps between launches, so what was last read shows offline; the account's socket
// says what each write moved, and the queries showing it ask again. A save goes at once, and a share
// waits in its outbox until the cloud takes it. A sign-in starts the cache, the files and the shares
// over, since they may be another account's; a relaunch keeps them. A sign-out, a session ended
// elsewhere and a deleted account clear them; a build the cloud no longer takes keeps everything
// until it is updated. Each launch and each return to the front asks Better Auth whether the
// session stands, which also slides it on.

import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { defaultShouldDehydrateQuery, QueryClient } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { PersistQueryClientProviderProps } from "@tanstack/react-query-persist-client";
import type { WebSocketClass } from "@repo/client/account-socket";
import { createLibrarySocket, retryUnlessRefused } from "@repo/client/library-cache";
import type { ItemsMoved, LibrarySocket, ThreadPreviews } from "@repo/client/library-cache";
import { clientBuildValue } from "@repo/contract/client-build";
import type { ClientBuild } from "@repo/contract/client-build";
import { uploadBlob, v1Client } from "@repo/contract/library/call-outcome";
import type { SessionEnd } from "@repo/contract/library/call-outcome";
import type { V1Client } from "@repo/contract/v1";
import type { PhoneAuth } from "../auth/phone-auth";
import { createFileCache } from "../files/file-cache";
import type { FileCache, FileCachePorts, FileFolder } from "../files/file-cache";
import { createPhoneSaves } from "../items/phone-saves";
import type { PhoneSaves } from "../items/phone-saves";
import { clearStoredShares, createShareOutbox } from "../items/share-outbox";
import type { KvStorage, ShareOutbox } from "../items/share-outbox";
import { createLoginStore } from "../login/login-store";
import type { LoginStore } from "../login/login-store";
import { messageOf } from "./error-message";
import { createExternalStore } from "./external-store";
import type { ReadableStore } from "./external-store";
import { downloadBlob, phoneTransport } from "./phone-transport";

// what the cache keeps between launches, and how long a query it holds is used unasked
const CACHE_KEPT_MS = 7 * 24 * 60 * 60 * 1000;
const FRESH_MS = 30_000;
const CACHE_KEY = "library-cache";
// a cache that changes in a burst (a page of covers, a socket's frames) is written once for it
const CACHE_WRITE_MS = 1000;

export interface ComposeRuntimeArgs {
  readonly cloudUrl: string;
  readonly build: ClientBuild;
  readonly auth: PhoneAuth;
  // the phone's key-value store: the kept cache and the shares waiting
  readonly storage: KvStorage;
  readonly folder: FileFolder;
  // the global fetch, which every `/v1` call rides
  readonly fetch: (request: Request) => Promise<Response>;
  // the platform's WebSocket; null keeps the phone on its focus and reconnect refetches alone
  readonly WebSocket: WebSocketClass | null;
  // a fresh UUIDv7, which an item's id and an op id both are
  readonly newId: () => string;
  readonly newBlockId: () => string;
  readonly sha256Hex: (bytes: Uint8Array<ArrayBuffer>) => Promise<string>;
  readonly shrinkCover: FileCachePorts["shrink"];
}

// the account's library as this phone reaches it, while signed in
export interface PhoneLibrary {
  readonly client: V1Client;
  readonly queries: ReturnType<typeof createTanstackQueryUtils<V1Client>>;
  readonly files: FileCache;
  readonly saves: PhoneSaves;
  readonly shares: ShareOutbox;
  // the reply the agent is writing, as the socket carries it
  readonly previews: ThreadPreviews;
  // the items a write moved, as the socket says, or null when any may have: an open note's page
  // reads again what it shows of them
  readonly onItems: (listener: (moved: ItemsMoved) => void) => () => void;
  // a fresh op id for a write a screen makes
  readonly newId: () => string;
}

export type PhoneSession =
  | { readonly kind: "restoring" }
  // `notice`: why this phone is signed out when it did not sign out itself
  | { readonly kind: "signed-out"; readonly notice: string | null }
  | { readonly kind: "signed-in"; readonly library: PhoneLibrary }
  // the cloud no longer takes this build: everything is kept until the app is updated
  | { readonly kind: "outdated" }
  // the phone's store would not open
  | { readonly kind: "failed"; readonly message: string };

// `waiting`: shares the cloud has not taken, which signing out would discard
export type LogoutOutcome =
  | { readonly kind: "signed-out" }
  | { readonly kind: "waiting"; readonly saves: number }
  // the phone could not let its copy go, so it stays signed in, and the screen says why
  | { readonly kind: "failed"; readonly message: string };

// where this runtime's sign-in stands: nothing open; its library open, with its socket; or a
// leave under way, whose outcome a sign-out asked meanwhile waits for
type Phase =
  | { readonly kind: "closed" }
  | { readonly kind: "open"; readonly library: PhoneLibrary; readonly socket: LibrarySocket }
  | { readonly kind: "leaving"; readonly done: Promise<LogoutOutcome> };

const CLOSED: Phase = { kind: "closed" };

// whether the app is in front and online, as it last said: unsaid until it first says, which a
// socket meets as reachable and a resume as a return
type Reach = "unsaid" | "reached" | "away";

export interface AppRuntime {
  readonly session: ReadableStore<PhoneSession>;
  readonly login: LoginStore;
  // every query of the sign-in, and how the app keeps them between launches
  readonly queryClient: QueryClient;
  readonly persistOptions: PersistQueryClientProviderProps["persistOptions"];
  // reads the kept session once and ends `restoring` either way
  readonly start: () => Promise<void>;
  // refuses while shares wait, unless told to discard them
  readonly logout: (options?: { readonly discardWaiting?: boolean }) => Promise<LogoutOutcome>;
  // the app is in front and online again: the socket dials, the shares go and the session is
  // asked, once however many times it is told before the next suspend
  readonly resume: () => void;
  // the app went behind or offline: the socket goes until it resumes
  readonly suspend: () => void;
}

export const SIGNED_OUT_ELSEWHERE = "This iPhone was signed out of your library.";
const ACCOUNT_DELETED = "Your account was deleted, and its library with it.";

export const composeRuntime = (args: ComposeRuntimeArgs): AppRuntime => {
  const session = createExternalStore<PhoneSession>({ kind: "restoring" });
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: CACHE_KEPT_MS, retry: retryUnlessRefused, staleTime: FRESH_MS },
    },
  });
  const persister = createAsyncStoragePersister({
    key: CACHE_KEY,
    storage: args.storage,
    throttleTime: CACHE_WRITE_MS,
  });
  let phase: Phase = CLOSED;
  let reach: Reach = "unsaid";

  // the phase's one writer: a library that stops being open lets its socket go
  const enter = (next: Phase): void => {
    if (phase.kind === "open" && (next.kind !== "open" || next.library !== phase.library)) {
      phase.socket.close();
    }
    phase = next;
  };

  // a leave whose outcome every sign-out asked meanwhile shares; `run` awaits before it moves the
  // phase on, so the phase says leaving first
  const leaving = async (run: () => Promise<LogoutOutcome>): Promise<LogoutOutcome> => {
    const done = run();
    enter({ done, kind: "leaving" });
    return await done;
  };

  const transport = phoneTransport({
    build: args.build,
    cookie: args.auth.cookie,
    fetch: args.fetch,
    origin: args.cloudUrl,
  });

  const files = createFileCache({
    download: async (sha) =>
      phase.kind === "open" ? await downloadBlob(transport, args.sha256Hex, sha) : null,
    folder: args.folder,
    shrink: args.shrinkCover,
  });

  // everything of an account on this phone goes: its kept cache, its files and its shares
  const forgetAccount = async (shares: ShareOutbox | null): Promise<void> => {
    await (shares === null ? clearStoredShares(args.storage) : shares.clear());
    await files.clear();
    queryClient.clear();
    await persister.removeClient();
  };

  // this phone leaves its account, its library already stopped by the phase it left, so whether or
  // not the clear finishes it hears nothing more; the session goes only once the copy has, so a
  // copy that would not go is still the account's
  const leave = async (library: PhoneLibrary, notice: string | null): Promise<void> => {
    await forgetAccount(library.shares);
    await args.auth.signOut();
    enter(CLOSED);
    session.set({ kind: "signed-out", notice });
  };

  // the cloud ended this sign-in (a session ended elsewhere, a deleted account): the phone leaves
  // it, and is signed out all the same when its copy would not go, since nothing it holds reaches
  // the library any more; the session stays kept, so the next launch meets the same end and clears
  // again
  const ended = async (library: PhoneLibrary, notice: string): Promise<LogoutOutcome> => {
    try {
      await leave(library, notice);
    } catch (error) {
      enter(CLOSED);
      session.set({
        kind: "signed-out",
        notice: `${notice} The copy on this iPhone couldn't be removed yet; Inteligir tries again the next time it opens: ${messageOf(error)}`,
      });
    }
    return { kind: "signed-out" };
  };

  // a refusal of the sign-in itself, heard by any call of `library`'s; one heard under an earlier
  // sign-in, or while this one is already ending, ends nothing more
  const sessionEnded = (library: PhoneLibrary, end: SessionEnd): void => {
    if (phase.kind !== "open" || phase.library !== library) {
      return;
    }
    if (end === "outdated") {
      enter(CLOSED);
      session.set({ kind: "outdated" });
      return;
    }
    const notice = end === "gone" ? ACCOUNT_DELETED : SIGNED_OUT_ELSEWHERE;
    void leaving(async () => await ended(library, notice));
  };

  // Better Auth's own read: a session it no longer holds ends this one, and a cloud it could not
  // reach ends nothing
  const checkSession = async (library: PhoneLibrary): Promise<void> => {
    if ((await args.auth.check()) === "ended") {
      sessionEnded(library, "signed-out");
    }
  };

  const open = async (source: "restored" | "signed-in"): Promise<void> => {
    if (source === "signed-in") {
      // another account's library, or the last sign-in's, goes before this one's is read
      await forgetAccount(null);
    }
    let library: PhoneLibrary | null = null;
    const client = v1Client(transport, (end) => {
      if (library !== null) {
        sessionEnded(library, end);
      }
    });
    const queries = createTanstackQueryUtils(client);
    const saves = createPhoneSaves({
      client,
      files,
      newBlockId: args.newBlockId,
      newId: args.newId,
      now: Date.now,
      sha256Hex: args.sha256Hex,
      upload: async (file) => {
        const sent = await uploadBlob(transport, file);
        if (sent.kind === "failed" && sent.failure.kind === "session" && library !== null) {
          sessionEnded(library, sent.failure.end);
        }
        return sent;
      },
    });
    const shares = createShareOutbox({
      landed: () => {
        void queryClient.invalidateQueries({ queryKey: queries.library.listing.key() });
      },
      saves,
      storage: args.storage,
    });
    await shares.load();
    const socket = createLibrarySocket({
      client,
      origin: args.cloudUrl,
      queries,
      queryClient,
      WebSocket: args.WebSocket ?? undefined,
    });
    const made: PhoneLibrary = {
      client,
      files,
      newId: args.newId,
      onItems: socket.onItems,
      previews: socket.previews,
      queries,
      saves,
      shares,
    };
    library = made;
    enter({ kind: "open", library: made, socket });
    session.set({ kind: "signed-in", library: made });
    if (reach === "away") {
      socket.offline();
    }
    if (args.WebSocket !== null) {
      socket.connect();
    }
    void shares.flush();
  };

  // the kept sign-in's library opened over what the phone holds, or why it could not be
  const restore = async (): Promise<void> => {
    try {
      await open("restored");
    } catch (error) {
      enter(CLOSED);
      session.set({ kind: "failed", message: messageOf(error) });
    }
  };

  // a sign-out of `library`'s: the phone stays signed in when its copy would not go, and opens
  // again what it still holds, under the sign-in it never let go
  const signOut = async (library: PhoneLibrary): Promise<LogoutOutcome> => {
    try {
      await leave(library, null);
    } catch (error) {
      await restore();
      return { kind: "failed", message: messageOf(error) };
    }
    return { kind: "signed-out" };
  };

  const login = createLoginStore({
    auth: args.auth,
    signedIn: async () => {
      await open("signed-in");
    },
  });

  let started = false;

  return {
    async logout(options = {}) {
      if (phase.kind === "leaving") {
        return await phase.done;
      }
      if (phase.kind === "closed") {
        return { kind: "signed-out" };
      }
      const { library } = phase;
      const waiting = library.shares.waiting.get().length;
      if (waiting > 0 && options.discardWaiting !== true) {
        return { kind: "waiting", saves: waiting };
      }
      return await leaving(async () => await signOut(library));
    },
    login,
    persistOptions: {
      buster: clientBuildValue(args.build),
      dehydrateOptions: {
        // a file's address is this launch's, and a mutation is never kept
        shouldDehydrateMutation: () => false,
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) && query.meta?.persist !== false,
      },
      maxAge: CACHE_KEPT_MS,
      persister,
    },
    queryClient,
    resume() {
      if (reach === "reached") {
        return;
      }
      reach = "reached";
      if (phase.kind === "open") {
        phase.socket.online();
        void phase.library.shares.flush();
        void checkSession(phase.library);
      }
    },
    session,
    async start() {
      if (started) {
        return;
      }
      started = true;
      let kept: string | null = null;
      try {
        kept = await args.auth.cookie();
      } catch (error) {
        login.fail(`The saved sign-in could not be read: ${messageOf(error)}`);
      }
      if (kept === null) {
        session.set({ kind: "signed-out", notice: null });
        return;
      }
      await restore();
      if (phase.kind === "open") {
        void checkSession(phase.library);
      }
    },
    suspend() {
      reach = "away";
      if (phase.kind === "open") {
        phase.socket.offline();
      }
    },
  };
};
