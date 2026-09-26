// the phone's own runtime, the one the app composes, under node: node's sqlite, its files in
// memory, a network the scenario can take away, and a credential the scenario holds

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createCloudClient } from "@repo/api/cloud/client";
import type { CloudFetch } from "@repo/api/cloud/client";
import type { DeviceCredential } from "@repo/api/cloud/device/device-schema";
import { composeRuntime } from "@repo/mobile/lib/compose-runtime";
import type { AppRuntime } from "@repo/mobile/lib/compose-runtime";
import { openNodeSqlDriver } from "@repo/mobile/lib/node-sql-driver";
import type { AttachmentFiles } from "@repo/mobile/notes/attachment-files";
import type { OutboxFiles } from "@repo/mobile/notes/outbox-files";
import { expect } from "./assert";
import { pollUntil } from "./poll";

export const PHONE_NAME = "E2E Phone";

const MIRROR_DEADLINE_MS = 20_000;

// the phone's files that are not the database, answered as the async ports they stand in for
const memoryFiles = (): AttachmentFiles & OutboxFiles => {
  const files = new Map<string, Uint8Array>();
  return {
    clear: () => {
      files.clear();
      return Promise.resolve();
    },
    find: (name) => Promise.resolve(files.has(name) ? `memory://${name}` : null),
    read: (name) => {
      const bytes = files.get(name);
      expect(bytes !== undefined, `the phone staged ${name}`);
      return Promise.resolve(bytes);
    },
    remove: (name) => {
      files.delete(name);
      return Promise.resolve();
    },
    save: (name, bytes) => {
      files.set(name, bytes);
      return Promise.resolve(`memory://${name}`);
    },
    stage: (name, bytes) => {
      files.set(name, bytes);
      return Promise.resolve();
    },
  };
};

// the scenario holds the phone's credential; the phone never signs out here
const heldCredential = (credential: DeviceCredential) => ({
  clear: () => Promise.resolve(),
  read: () => Promise.resolve(credential),
  write: () => Promise.resolve(),
});

export const phoneRuntime = async (
  origin: string,
  dir: string,
  credential: DeviceCredential,
  network: { online: boolean },
): Promise<AppRuntime> => {
  await mkdir(dir, { recursive: true });
  const fetch: CloudFetch = async (input, init) => {
    if (!network.online) {
      throw new Error("the phone is offline");
    }
    return await globalThis.fetch(input, init);
  };
  const files = memoryFiles();
  return composeRuntime({
    attachments: files,
    cloudUrl: origin,
    credentials: heldCredential(credential),
    db: openNodeSqlDriver(path.join(dir, "inteligir.db")),
    deviceName: PHONE_NAME,
    mintId: () => randomBytes(16).toString("hex"),
    mintNoteId: randomUUID,
    outboxFiles: files,
    randomBytes: (length) => randomBytes(length),
    retryBaseMs: null,
    sha1: (bytes) => Promise.resolve(createHash("sha1").update(bytes).digest()),
    sync: {
      createClient: (signedIn) =>
        createCloudClient({ baseUrl: origin, credential: signedIn.credential, fetch }),
      pollIntervalMs: null,
    },
  });
};

// until the phone lists every path and holds every note's text
export const untilMirrored = async (phone: AppRuntime, paths: readonly string[]): Promise<void> => {
  await pollUntil(
    () => Promise.resolve(phone.notes.tree.get()),
    (tree) =>
      tree.state === "ready" &&
      tree.progress === null &&
      paths.every((wanted) => tree.entries.some((entry) => entry.path === wanted)),
    {
      deadlineMs: MIRROR_DEADLINE_MS,
      describe: (tree) => `the phone's notes are still ${tree.state}`,
    },
  );
};

export const readPhoneNote = async (phone: AppRuntime, notePath: string): Promise<string> => {
  const read = await phone.notes.readNote(notePath);
  expect(read.ok, `the phone reads ${notePath}: ${read.ok ? "" : read.message}`);
  return read.content;
};
