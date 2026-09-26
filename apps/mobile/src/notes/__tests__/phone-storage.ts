// the phone's stores for the tests: the SQL port over a real file, attachment and outbox files kept
// in memory under uris that name them, and node's SHA-1

import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCloudClient } from "@repo/api/cloud/client";
import type { CloudFetch } from "@repo/api/cloud/client";
import { onTestFinished } from "vitest";
import { openNodeSqlDriver } from "../../lib/node-sql-driver";
import type { SqlDriver } from "../../lib/sql-driver";
import { createSqliteSyncStore } from "../../sync/sqlite-sync-store";
import { createSyncRuntime } from "../../sync/sync-runtime";
import type { SyncStore } from "../../sync/sync-store";
import type { AttachmentFiles } from "../attachment-files";
import { createNotesStore } from "../notes-store";
import type { NotesStore } from "../notes-store";
import type { Sha1 } from "../outbox-ops";
import type { OutboxFiles } from "../outbox-files";

// a database file of its own, removed when the test ends; open it again to relaunch
export const tempDbPath = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "inteligir-phone-"));
  onTestFinished(() => {
    rmSync(dir, { force: true, recursive: true });
  });
  return path.join(dir, "inteligir.db");
};

export const openTempDb = (file: string = tempDbPath()) => {
  const db = openNodeSqlDriver(file);
  onTestFinished(() => {
    db.close();
  });
  return db;
};

export const createMemoryAttachments = (): AttachmentFiles & {
  names: () => string[];
  read: (name: string) => Uint8Array | null;
} => {
  const files = new Map<string, Uint8Array>();
  return {
    clear: async () => {
      files.clear();
    },
    find: async (name) => (files.has(name) ? `memory://${name}` : null),
    names: () => [...files.keys()],
    read: (name) => files.get(name) ?? null,
    save: async (name, bytes) => {
      files.set(name, bytes);
      return `memory://${name}`;
    },
  };
};

export const createMemoryOutboxFiles = (): OutboxFiles & { names: () => string[] } => {
  const files = new Map<string, Uint8Array>();
  return {
    clear: async () => {
      files.clear();
    },
    find: async (name) => (files.has(name) ? `memory://outbox/${name}` : null),
    names: () => [...files.keys()],
    read: async (name) => {
      const bytes = files.get(name);
      if (bytes === undefined) {
        throw new Error(`no staged file ${name}`);
      }
      return bytes;
    },
    remove: async (name) => {
      files.delete(name);
    },
    stage: async (name, bytes) => {
      files.set(name, bytes);
    },
  };
};

export const nodeSha1: Sha1 = async (bytes) => createHash("sha1").update(bytes).digest();

// the synced threads over a database file; reset it "restored" to read back what a file holds
export const openSyncStore = (db: SqlDriver = openTempDb()): SyncStore =>
  createSqliteSyncStore({ db, sha1: nodeSha1 });

// the ports one notes store takes beside its database and session; no retry timer, so a test says
// when the queue drains
export const phonePorts = () => ({
  attachments: createMemoryAttachments(),
  deviceName: "Test Phone",
  outboxFiles: createMemoryOutboxFiles(),
  retryBaseMs: null,
  sha1: nodeSha1,
});

const CREDENTIAL = { credential: `igd_${"a".repeat(64)}`, deviceId: "dev_1" };

// one launch of the phone over a database file, signed in as the boot restore does
export const launchPhone = (
  fetch: CloudFetch,
  db: SqlDriver = openTempDb(),
  ports: ReturnType<typeof phonePorts> = phonePorts(),
): NotesStore => {
  const sync = createSyncRuntime({
    cloudUrl: "https://cloud.test",
    createClient: (credential) =>
      createCloudClient({
        baseUrl: "https://cloud.test",
        credential: credential.credential,
        fetch,
      }),
    pollIntervalMs: null,
    store: openSyncStore(db),
  });
  const store = createNotesStore({ ...ports, db, session: sync.session });
  sync.setCredential(CREDENTIAL);
  store.reset("restored");
  return store;
};
