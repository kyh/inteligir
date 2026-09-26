// the platform-free half of the composition root: app-runtime.ts binds it to the Keychain, the
// database, the attachment and outbox files, SHA-1 and the OS, so every transition between signed
// in and out runs under test, and the scenario suite drives it under node against a real Worker.

import type { DeviceCredential } from "@repo/api/cloud/device/device-schema";
import type { DeviceCredentialStore } from "@repo/api/cloud/device/login-flow";
import { createCaptureSender } from "../capture/capture-sender";
import type { CaptureSender } from "../capture/capture-sender";
import { createLoginStore } from "../login/login-store";
import type { LoginStore } from "../login/login-store";
import type { AttachmentFiles } from "../notes/attachment-files";
import { createFileOps } from "../notes/file-ops";
import type { FileOps } from "../notes/file-ops";
import { createNotesStore } from "../notes/notes-store";
import type { CreateNotesStoreArgs, NotesStore, SignInSource } from "../notes/notes-store";
import type { Sha1 } from "../notes/outbox-ops";
import type { OutboxFiles } from "../notes/outbox-files";
import { createMemorySyncStore } from "../sync/memory-sync-store";
import { createSyncRuntime } from "../sync/sync-runtime";
import type { SyncRuntime, SyncRuntimeArgs } from "../sync/sync-runtime";
import type { SyncStore } from "../sync/sync-store";
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
  attachments: AttachmentFiles;
  outboxFiles: OutboxFiles;
  sha1: Sha1;
  // the name the phone signs in as, which its conflict reports and copies go by
  deviceName: string;
  mintCaptureKey: () => string;
  sync?: Omit<SyncRuntimeArgs, "cloudUrl" | "store">;
  // the first wait after a failed send of the phone's edits; null never retries on a timer
  retryBaseMs?: number | null;
}

// `unsent`: the phone holds edits the vault has not taken, and signing out would discard them
export type LogoutOutcome = { kind: "signed-out" } | { kind: "unsent"; count: number };

export interface AppRuntime {
  store: SyncStore;
  sync: SyncRuntime;
  notes: NotesStore;
  fileOps: FileOps;
  login: LoginStore;
  // reads the stored credential once and ends `restoring` either way
  start: () => Promise<void>;
  // refuses while edits are unsent, unless told to discard them
  logout: (options?: { discardUnsent?: boolean }) => Promise<LogoutOutcome>;
  // the app is back in the foreground or back online; every one no-ops while signed out
  resume: () => void;
  submitCapture: CaptureSender;
}

export const composeRuntime = (args: ComposeRuntimeArgs): AppRuntime => {
  const store = createMemorySyncStore();
  const sync = createSyncRuntime({ ...args.sync, cloudUrl: args.cloudUrl, store });
  const notesArgs: CreateNotesStoreArgs = {
    attachments: args.attachments,
    db: args.db,
    deviceName: args.deviceName,
    outboxFiles: args.outboxFiles,
    session: sync.session,
    sha1: args.sha1,
  };
  if (args.retryBaseMs !== undefined) {
    notesArgs.retryBaseMs = args.retryBaseMs;
  }
  const notes = createNotesStore(notesArgs);

  // the tree is fetched here so no screen carries its own cold-fetch effect, and the edits the last
  // launch left are sent.
  const activate = (credential: DeviceCredential, source: SignInSource): void => {
    sync.setCredential(credential);
    notes.reset(source);
    sync.start();
    void notes.refresh();
    void notes.drain();
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
    fileOps: createFileOps(notes),
    async logout(options = {}) {
      const unsent = await notes.unsentCount();
      if (unsent > 0 && options.discardUnsent !== true) {
        return { count: unsent, kind: "unsent" };
      }
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
      return { kind: "signed-out" };
    },
    login,
    notes,
    resume() {
      void sync.syncNow();
      void notes.refresh();
      void notes.drain();
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
