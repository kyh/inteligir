// the platform-free half of the composition root: app-runtime.ts binds it to the Keychain, the
// database, SHA-1 and the OS, so every transition between signed in and out runs under test.

import type { DeviceCredential } from "@repo/contract/cloud/device/device-schema";
import type { DeviceCredentialStore } from "@repo/contract/cloud/device/login-flow";
import { createDispatchRuntime } from "../dispatch/dispatch-runtime";
import type { DispatchRuntime, DispatchRuntimeArgs } from "../dispatch/dispatch-runtime";
import { createLoginStore } from "../login/login-store";
import type { LoginStore } from "../login/login-store";
import { createLiveTurns } from "../sync/live-turns";
import type { LiveTurns } from "../sync/live-turns";
import { createSqliteSyncStore } from "../sync/sqlite-sync-store";
import type { Sha1 } from "../sync/sqlite-sync-store";
import { createSyncRuntime } from "../sync/sync-runtime";
import type { SyncRuntime, SyncRuntimeArgs } from "../sync/sync-runtime";
import type { SignInSource, SyncStore } from "../sync/sync-store";
import { messageOf } from "./error-message";
import type { SqlDriver } from "./sql-driver";

export interface CredentialStore extends DeviceCredentialStore {
  read: () => Promise<DeviceCredential | null>;
  clear: () => Promise<void>;
}

export interface ComposeRuntimeArgs {
  cloudUrl: string;
  credentials: CredentialStore;
  // opened once for the app's life; a restore keeps what it holds, every other sign-in wipes it
  db: SqlDriver;
  sha1: Sha1;
  // 16 random bytes as hex: a dispatch's id and a new thread's
  mintId: () => string;
  sync?: Omit<SyncRuntimeArgs, "cloudUrl" | "onDispatchPing" | "store">;
  // how often a waiting request's fate is asked; null never polls on a timer
  dispatchPollIntervalMs?: DispatchRuntimeArgs["pollIntervalMs"];
}

// `unsent`: the phone holds requests no Mac holds yet, and signing out would discard them
export type LogoutOutcome = { kind: "signed-out" } | { kind: "unsent"; requests: number };

export interface AppRuntime {
  store: SyncStore;
  // what a running turn has streamed and not yet settled; the store holds the settled items
  live: Pick<LiveTurns, "snapshot" | "subscribe">;
  sync: SyncRuntime;
  dispatch: DispatchRuntime;
  login: LoginStore;
  // reads the stored credential once and ends `restoring` either way
  start: () => Promise<void>;
  // refuses while requests are unsent, unless told to discard them
  logout: (options?: { discardUnsent?: boolean }) => Promise<LogoutOutcome>;
  // the app is back in the foreground or back online; every one no-ops while signed out
  resume: () => void;
  // the app left the foreground: the socket closes and nothing polls until it resumes
  suspend: () => void;
}

export const composeRuntime = (args: ComposeRuntimeArgs): AppRuntime => {
  const live = createLiveTurns();
  const store = createSqliteSyncStore({ db: args.db, live, sha1: args.sha1 });
  // the ping reaches the dispatch runtime, which reads under the sync runtime's session and so is
  // built after it; bound below, before start() can open the socket
  let pinged: { dispatch: () => void } | null = null;
  const sync = createSyncRuntime({
    ...args.sync,
    cloudUrl: args.cloudUrl,
    onDispatchPing: () => {
      pinged?.dispatch();
    },
    store,
  });
  const dispatchArgs: DispatchRuntimeArgs = {
    db: args.db,
    mintId: args.mintId,
    pull: () => {
      void sync.syncNow();
    },
    session: sync.session,
    threads: store,
  };
  if (args.dispatchPollIntervalMs !== undefined) {
    dispatchArgs.pollIntervalMs = args.dispatchPollIntervalMs;
  }
  if (args.sync?.onDebug !== undefined) {
    dispatchArgs.onDebug = args.sync.onDebug;
  }
  const dispatch = createDispatchRuntime(dispatchArgs);
  pinged = {
    dispatch: () => {
      void dispatch.sendNow();
    },
  };

  // the requests the last launch left are sent. a restore's threads are read back before the sign-in
  // is published, so the list mounts on what the last launch held and the first pull starts at
  // its cursor.
  const activate = async (credential: DeviceCredential, source: SignInSource): Promise<void> => {
    await store.reset(source);
    sync.setCredential(credential);
    dispatch.reset(source);
    sync.start();
    void dispatch.sendNow();
  };

  const login = createLoginStore({
    client: { baseUrl: args.cloudUrl },
    store: {
      write: async (credential) => {
        await args.credentials.write(credential);
        await activate(credential, "signed-in");
      },
    },
  });

  // whichever request hears the refusal, what this sign-in fetched is not served again. the
  // credential stays stored, so the sign-in screen can still say this device was signed out.
  let previous = sync.get().state;
  sync.subscribe(() => {
    const { state } = sync.get();
    if (state === "unauthorized" && previous !== "unauthorized") {
      dispatch.reset(null);
      void store.reset(null);
    }
    previous = state;
  });

  let started = false;

  return {
    async logout(options = {}) {
      const requests = await dispatch.unclaimedCount();
      if (requests > 0 && options.discardUnsent !== true) {
        return { kind: "unsent", requests };
      }
      // cleared before the runtimes stop: a sign-in the screen allows once they have would write
      // a credential this delete could then remove.
      try {
        await args.credentials.clear();
      } catch (error) {
        login.fail(
          `Signed out, but the saved sign-in could not be removed and may return on the next launch: ${messageOf(error)}`,
        );
      }
      sync.setCredential(null);
      dispatch.reset(null);
      await store.reset(null);
      return { kind: "signed-out" };
    },
    dispatch,
    live,
    login,
    resume() {
      sync.resume();
      dispatch.resume();
    },
    async start() {
      if (started) {
        return;
      }
      started = true;
      let stored: DeviceCredential | null = null;
      try {
        stored = await args.credentials.read();
      } catch (error) {
        login.fail(`The saved sign-in could not be read: ${messageOf(error)}`);
      }
      if (stored === null) {
        sync.setCredential(null);
        return;
      }
      await activate(stored, "restored");
    },
    store,
    suspend() {
      sync.suspend();
      dispatch.suspend();
    },
    sync,
  };
};
