// the platform-free half of the composition root: app-runtime.ts binds it to the Keychain, the
// database, the attachment and outbox files, SHA-1, the page's fetch and reader and the OS, so every
// transition between signed in and out runs under test, and the scenario suite drives it under
// node against a real Worker.

import type { ClientBuild } from "@repo/contract/cloud/client-build";
import type { DeviceCredential } from "@repo/contract/cloud/device/device-schema";
import { createFillQueue } from "../items/fill-queue";
import type { FillQueue } from "../items/fill-queue";
import { createItemOps } from "../items/item-ops";
import type { ItemOps } from "../items/item-ops";
import { fillLink } from "../items/link-fill";
import type { LinkFillPorts } from "../items/link-fill";
import { createLoginStore } from "../login/login-store";
import type { LoginStore } from "../login/login-store";
import type { AttachmentFiles } from "../notes/attachment-files";
import { createAnnotationOps } from "../notes/annotation-ops";
import type { AnnotationOps } from "../notes/annotation-ops";
import { createFileOps } from "../notes/file-ops";
import type { FileOps } from "../notes/file-ops";
import { createNotesStore } from "../notes/notes-store";
import type { CreateNotesStoreArgs, NotesStore } from "../notes/notes-store";
import type { Sha1 } from "../notes/outbox-ops";
import type { OutboxFiles } from "../notes/outbox-files";
import { createSyncRuntime } from "../sync/sync-runtime";
import type { SyncRuntime, SyncRuntimeArgs } from "../sync/sync-runtime";
import { messageOf } from "./error-message";
import type { SignInSource } from "./sign-in-fence";
import type { SqlDriver } from "./sql-driver";

export interface CredentialStore {
  read: () => Promise<DeviceCredential | null>;
  write: (credential: DeviceCredential) => Promise<void>;
  clear: () => Promise<void>;
}

export interface ComposeRuntimeArgs {
  cloudUrl: string;
  build: ClientBuild;
  credentials: CredentialStore;
  // openPhoneDb's, opened once for the app's life; a restore keeps what it holds, every other
  // sign-in wipes it
  db: SqlDriver;
  attachments: AttachmentFiles;
  outboxFiles: OutboxFiles;
  sha1: Sha1;
  deviceName: string;
  randomBytes: (length: number) => Uint8Array;
  // a uuid: a saved item's id, and a note's for its first annotation
  newId: () => string;
  sync?: Omit<SyncRuntimeArgs, "build" | "cloudUrl" | "onVaultPing">;
  retryBaseMs?: CreateNotesStoreArgs["retryBaseMs"];
  // what a saved link is read through: the page's fetch, the reader, the cover's shrink and hash,
  // and whether the phone is online now
  fill: Omit<LinkFillPorts, "now" | "store"> & {
    online: () => boolean;
    setTimer?: (ms: number, run: () => void) => () => void;
  };
}

// `unsent`: the phone holds edits the vault has not taken, and signing out would discard them
// `unread`: links saved here whose page no device will read once this phone signs out
export type LogoutOutcome =
  | { kind: "signed-out" }
  | { kind: "unsent"; edits: number; unread: number };

export interface AppRuntime {
  sync: SyncRuntime;
  notes: NotesStore;
  fileOps: FileOps;
  // saving a link or a thought into Unsorted
  items: ItemOps;
  // the links this phone saved and has not read yet
  fills: FillQueue;
  annotations: AnnotationOps;
  login: LoginStore;
  // reads the stored credential once and ends `restoring` either way
  start: () => Promise<void>;
  // refuses while edits are unsent, unless told to discard them
  logout: (options?: { discardUnsent?: boolean }) => Promise<LogoutOutcome>;
  // the app is back in the foreground or back online; every one no-ops while signed out
  resume: () => void;
  // the app left the foreground: the socket closes and nothing polls until it resumes
  suspend: () => void;
}

export const composeRuntime = (args: ComposeRuntimeArgs): AppRuntime => {
  // the ping reaches the notes store, which reads under the sync runtime's session and so is built
  // after it; bound below, before start() can open the socket
  let pinged: (() => void) | null = null;
  const sync = createSyncRuntime({
    ...args.sync,
    build: args.build,
    cloudUrl: args.cloudUrl,
    onVaultPing: () => {
      pinged?.();
    },
  });
  const notesArgs: CreateNotesStoreArgs = {
    attachments: args.attachments,
    db: args.db,
    deviceName: args.deviceName,
    mintNoteId: args.newId,
    outboxFiles: args.outboxFiles,
    session: sync.session,
    sha1: args.sha1,
  };
  if (args.retryBaseMs !== undefined) {
    notesArgs.retryBaseMs = args.retryBaseMs;
  }
  const notes = createNotesStore(notesArgs);
  pinged = () => {
    void notes.refresh();
  };

  const { online, setTimer, ...readers } = args.fill;
  const fills = createFillQueue({
    canFill: () => sync.get().state === "signed-in" && online(),
    fill: async (row, mayRetry) =>
      await fillLink({ ...readers, now: () => Date.now(), store: notes }, row, mayRetry),
    now: () => Date.now(),
    setTimer:
      setTimer ??
      ((ms, run) => {
        const timer = setTimeout(run, ms);
        return () => {
          clearTimeout(timer);
        };
      }),
    store: notes,
  });

  // the tree is fetched here so no screen carries its own cold-fetch effect, and the edits the last
  // launch left are sent.
  const activate = (credential: DeviceCredential, source: SignInSource): void => {
    sync.setCredential(credential);
    notes.reset(source);
    sync.start();
    void notes.refresh();
    void notes.drain();
    fills.wake();
  };

  const login = createLoginStore({
    client: { baseUrl: args.cloudUrl, build: args.build },
    store: {
      // the bearer alone: nothing the phone runs asks whose account it is
      write: async (answer) => {
        const credential: DeviceCredential = {
          credential: answer.credential,
          deviceId: answer.deviceId,
        };
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
    annotations: createAnnotationOps({
      now: () => Math.floor(Date.now() / 1000),
      randomBytes: args.randomBytes,
      store: notes,
    }),
    fileOps: createFileOps(notes, { now: () => new Date() }),
    fills,
    items: createItemOps({
      newId: args.newId,
      now: () => new Date(),
      linkSaved: fills.wake,
      store: notes,
    }),
    async logout(options = {}) {
      const edits = await notes.unsentCount();
      const unread = await notes.unreadCount();
      if (edits + unread > 0 && options.discardUnsent !== true) {
        return { edits, kind: "unsent", unread };
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
      notes.reset(null);
      return { kind: "signed-out" };
    },
    login,
    notes,
    resume() {
      sync.resume();
      void notes.refresh();
      void notes.drain();
      fills.wake();
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
      activate(stored, "restored");
    },
    suspend() {
      sync.suspend();
      fills.suspend();
    },
    sync,
  };
};
