// the platform-free half of the composition root: app-runtime.ts binds it to the Keychain, the
// disk cache and the OS, so every transition between signed in and out runs under test.

import type { DeviceCredential } from "@repo/api/cloud/device/device-schema";
import type { DeviceCredentialStore } from "@repo/api/cloud/device/login-flow";
import { createCaptureSender } from "../capture/capture-sender";
import type { CaptureSender } from "../capture/capture-sender";
import { createLoginStore } from "../login/login-store";
import type { LoginStore } from "../login/login-store";
import type { NoteCache } from "../notes/note-cache";
import { createNotesStore } from "../notes/notes-store";
import type { NotesStore, SignInSource } from "../notes/notes-store";
import { createMemorySyncStore } from "../sync/memory-sync-store";
import { createSyncRuntime } from "../sync/sync-runtime";
import type { SyncRuntime, SyncRuntimeArgs } from "../sync/sync-runtime";
import type { SyncStore } from "../sync/sync-store";

export interface CredentialStore extends DeviceCredentialStore {
  read: () => Promise<DeviceCredential | null>;
  clear: () => Promise<void>;
}

export interface ComposeRuntimeArgs {
  cloudUrl: string;
  credentials: CredentialStore;
  cache: NoteCache;
  mintCaptureKey: () => string;
  sync?: Omit<SyncRuntimeArgs, "cloudUrl" | "store">;
}

export interface AppRuntime {
  store: SyncStore;
  sync: SyncRuntime;
  notes: NotesStore;
  login: LoginStore;
  // reads the stored credential once and ends `restoring` either way
  start: () => Promise<void>;
  logout: () => Promise<void>;
  // the app is back in the foreground; both no-op while signed out
  resume: () => void;
  submitCapture: CaptureSender;
}

export const composeRuntime = (args: ComposeRuntimeArgs): AppRuntime => {
  const store = createMemorySyncStore();
  const sync = createSyncRuntime({ ...args.sync, cloudUrl: args.cloudUrl, store });
  const notes = createNotesStore({ cache: args.cache, session: sync.session });

  // the tree is fetched here so no screen carries its own cold-fetch effect.
  const activate = (credential: DeviceCredential, source: SignInSource): void => {
    sync.setCredential(credential);
    notes.reset(source);
    sync.start();
    void notes.refresh();
  };

  const login = createLoginStore({
    client: { baseUrl: args.cloudUrl },
    store: {
      write: async (credential) => {
        await args.credentials.write(credential);
        activate(credential, "signed-in");
      },
    },
  });

  // whichever request hears the refusal, what this sign-in fetched is not served again. the
  // credential stays stored, so the sign-in screen can still say this device was signed out.
  let previous = sync.get().state;
  sync.subscribe(() => {
    const { state } = sync.get();
    if (state === "unauthorized" && previous !== "unauthorized") {
      notes.reset(null);
    }
    previous = state;
  });

  let started = false;

  return {
    async logout() {
      // cleared before the runtimes stop: a sign-in the screen allows once they have would write
      // a credential this delete could then remove.
      try {
        await args.credentials.clear();
      } catch (error) {
        login.fail(
          `Signed out, but the saved sign-in could not be removed and may return on the next launch: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      sync.setCredential(null);
      notes.reset(null);
    },
    login,
    notes,
    resume() {
      void sync.syncNow();
      void notes.refresh();
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
        login.fail(
          `The saved sign-in could not be read: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (stored === null) {
        sync.setCredential(null);
        return;
      }
      activate(stored, "restored");
    },
    store,
    submitCapture: createCaptureSender({ mintKey: args.mintCaptureKey, send: sync.createCapture }),
    sync,
  };
};
