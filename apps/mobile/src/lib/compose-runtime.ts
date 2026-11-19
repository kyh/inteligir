import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { defaultShouldDehydrateQuery, QueryClient } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { PersistQueryClientProviderProps } from "@tanstack/react-query-persist-client";
import { retryUnlessRefused } from "@repo/client/library-cache";
import type { ItemsMoved } from "@repo/client/library-cache";
import { createLibraryChanges } from "@repo/client/library-changes";
import type { KvStorage } from "@repo/client/waiting-saves";
import { clientBuildValue } from "@repo/contract/client-build";
import type { ClientBuild } from "@repo/contract/client-build";
import { uploadBlob, v1Client } from "@repo/contract/rpc/call-outcome";
import type { SessionEnd } from "@repo/contract/rpc/call-outcome";
import type { V1Client } from "@repo/contract/rpc/v1-contract";
import type { PhoneAuth } from "../auth/phone-auth";
import { createFileCache } from "../files/file-cache";
import type { FileCache, FileCachePorts, FileFolder } from "../files/file-cache";
import { createPhoneSaves } from "../items/phone-saves";
import type { PhoneSaves } from "../items/phone-saves";
import { clearStoredShares, createShareOutbox } from "../items/share-outbox";
import type { ShareOutbox } from "../items/share-outbox";
import { createLoginStore } from "../login/login-store";
import type { LoginStore } from "../login/login-store";
import { messageOf } from "./error-message";
import { createExternalStore } from "./external-store";
import type { ReadableStore } from "./external-store";
import { downloadBlob, phoneTransport } from "./phone-transport";

const CACHE_KEPT_MS = 7 * 24 * 60 * 60 * 1000;
const FRESH_MS = 30_000;
const CACHE_KEY = "library-cache";
const CACHE_WRITE_MS = 1000;

export interface ComposeRuntimeArgs {
  readonly cloudUrl: string;
  readonly build: ClientBuild;
  readonly auth: PhoneAuth;
  readonly storage: KvStorage;
  readonly folder: FileFolder;
  readonly fetch: (request: Request) => Promise<Response>;
  readonly newId: () => string;
  readonly newBlockId: () => string;
  readonly sha256Hex: (bytes: Uint8Array<ArrayBuffer>) => Promise<string>;
  readonly measurePicture: FileCachePorts["measure"];
}

export interface PhoneLibrary {
  readonly client: V1Client;
  readonly queries: ReturnType<typeof createTanstackQueryUtils<V1Client>>;
  readonly files: FileCache;
  readonly saves: PhoneSaves;
  readonly shares: ShareOutbox;
  readonly onItems: (listener: (moved: ItemsMoved) => void) => () => void;
  readonly newId: () => string;
}

export type PhoneSession =
  | { readonly kind: "restoring" }
  | { readonly kind: "signed-out"; readonly notice: string | null }
  | { readonly kind: "signed-in"; readonly library: PhoneLibrary }
  | { readonly kind: "outdated" }
  | { readonly kind: "failed"; readonly message: string };

export type LogoutOutcome =
  | { readonly kind: "signed-out" }
  | { readonly kind: "waiting"; readonly saves: number }
  | { readonly kind: "failed"; readonly message: string };

type State =
  | Exclude<PhoneSession, { readonly kind: "signed-in" }>
  | { readonly kind: "open"; readonly library: PhoneLibrary; readonly stopAsking: () => void }
  | {
      readonly kind: "leaving";
      readonly library: PhoneLibrary;
      readonly done: Promise<LogoutOutcome>;
    };

const shown = (state: State) =>
  (state.kind === "open" || state.kind === "leaving"
    ? { kind: "signed-in", library: state.library }
    : state) satisfies PhoneSession;

export interface AppRuntime {
  readonly session: ReadableStore<PhoneSession>;
  readonly login: LoginStore;
  readonly queryClient: QueryClient;
  readonly persistOptions: PersistQueryClientProviderProps["persistOptions"];
  readonly start: () => Promise<void>;
  readonly logout: (options?: { readonly discardWaiting?: boolean }) => Promise<LogoutOutcome>;
  readonly reach: ReadableStore<boolean>;
  readonly setReach: (fact: { readonly front?: boolean; readonly online?: boolean }) => void;
}

export const SIGNED_OUT_ELSEWHERE = "This iPhone was signed out of your library.";
const ACCOUNT_DELETED = "Your account was deleted, and its library with it.";

export const composeRuntime = (args: ComposeRuntimeArgs) => {
  let state: State = { kind: "restoring" };
  const session = createExternalStore(shown(state));

  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { networkMode: "always" },
      queries: { gcTime: CACHE_KEPT_MS, retry: retryUnlessRefused, staleTime: FRESH_MS },
    },
  });

  const persister = createAsyncStoragePersister({
    key: CACHE_KEY,
    storage: args.storage,
    throttleTime: CACHE_WRITE_MS,
  });

  const move = (next: State) => {
    if (state.kind === "open") {
      state.stopAsking();
    }

    state = next;
    const before = session.get();
    const after = shown(next);

    if (
      before.kind !== "signed-in" ||
      after.kind !== "signed-in" ||
      before.library !== after.library
    ) {
      session.set(after);
    }
  };

  const leaving = async (library: PhoneLibrary, run: () => Promise<LogoutOutcome>) => {
    const done = run();
    move({ done, kind: "leaving", library });

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
      state.kind === "open" ? await downloadBlob(transport, args.sha256Hex, sha) : null,
    folder: args.folder,
    measure: args.measurePicture,
  });

  const forgetAccount = async (shares: ShareOutbox | null) => {
    await (shares === null ? clearStoredShares(args.storage) : shares.clear());
    await files.clear();
    queryClient.clear();
    await persister.removeClient();
  };

  const leave = async (library: PhoneLibrary, notice: string | null) => {
    await forgetAccount(library.shares);
    await args.auth.signOut();
    move({ kind: "signed-out", notice });
  };

  const ended = async (library: PhoneLibrary, notice: string) => {
    try {
      await leave(library, notice);
    } catch (error) {
      move({
        kind: "signed-out",
        notice: `${notice} The copy on this iPhone couldn't be removed yet; Inteligir tries again the next time it opens: ${messageOf(error)}`,
      });
    }

    return { kind: "signed-out" } satisfies LogoutOutcome;
  };

  const sessionEnded = (library: PhoneLibrary, end: SessionEnd) => {
    if (state.kind !== "open" || state.library !== library) {
      return;
    }

    if (end === "outdated") {
      move({ kind: "outdated" });

      return;
    }

    const notice = end === "gone" ? ACCOUNT_DELETED : SIGNED_OUT_ELSEWHERE;
    void leaving(library, async () => await ended(library, notice));
  };

  const checkSession = async (library: PhoneLibrary) => {
    if ((await args.auth.check()) === "ended") {
      sessionEnded(library, "signed-out");
    }
  };

  const reach = createExternalStore(true);
  let reachFacts = { front: true, online: true };

  const setReach: AppRuntime["setReach"] = (fact) => {
    reachFacts = { ...reachFacts, ...fact };
    const reaches = reachFacts.front && reachFacts.online;

    if (reaches !== reach.get()) {
      reach.set(reaches);
    }
  };

  reach.subscribe(() => {
    if (reach.get() && state.kind === "open") {
      void state.library.shares.flush();
      void checkSession(state.library);
    }
  });

  const open = async (source: "restored" | "signed-in") => {
    if (source === "signed-in") {
      await forgetAccount(null);
    }

    let library: PhoneLibrary | null = null;

    const onSessionEnd = (end: SessionEnd) => {
      if (library !== null) {
        sessionEnded(library, end);
      }
    };

    const client = v1Client(transport, onSessionEnd);
    const queries = createTanstackQueryUtils(client);

    const saves = createPhoneSaves({
      client,
      files,
      newBlockId: args.newBlockId,
      newId: args.newId,
      now: Date.now,
      sha256Hex: args.sha256Hex,
      upload: async (file) => {
        await uploadBlob(transport, file, onSessionEnd);
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
    const changes = createLibraryChanges({ client, queries, queryClient });

    const made: PhoneLibrary = {
      client,
      files,
      newId: args.newId,
      onItems: changes.onItems,
      queries,
      saves,
      shares,
    };

    library = made;
    move({ kind: "open", library: made, stopAsking: changes.start() });
    void shares.flush();
  };

  const restore = async () => {
    try {
      await open("restored");
    } catch (error) {
      move({ kind: "failed", message: messageOf(error) });
    }
  };

  const signOut = async (library: PhoneLibrary) => {
    try {
      await leave(library, null);
    } catch (error) {
      await restore();

      return { kind: "failed", message: messageOf(error) } satisfies LogoutOutcome;
    }

    return { kind: "signed-out" } satisfies LogoutOutcome;
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
      if (state.kind === "leaving") {
        return await state.done;
      }

      if (state.kind !== "open") {
        return { kind: "signed-out" };
      }

      const { library } = state;
      const waiting = library.shares.waiting.get().length;

      if (waiting > 0 && options.discardWaiting !== true) {
        return { kind: "waiting", saves: waiting };
      }

      return await leaving(library, async () => await signOut(library));
    },
    login,
    persistOptions: {
      buster: clientBuildValue(args.build),
      dehydrateOptions: {
        shouldDehydrateMutation: () => false,
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) && query.meta?.persist !== false,
      },
      maxAge: CACHE_KEPT_MS,
      persister,
    },
    queryClient,
    reach,
    session,
    setReach,
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
        move({ kind: "signed-out", notice: null });

        return;
      }

      await restore();

      if (state.kind === "open") {
        void checkSession(state.library);
      }
    },
  } satisfies AppRuntime;
};
