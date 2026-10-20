// the phone's own runtime, the one the app composes, under node: node's sqlite, its files in
// memory, a network the scenario can take away, a credential the harness logs in and holds, and
// the phone's own link fill: its page fetch over node's, and its page's reader mode over linkedom

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createCloudClient } from "@repo/contract/cloud/client";
import type { CloudFetch } from "@repo/contract/cloud/client";
import type { DeviceCredential } from "@repo/contract/cloud/device/device-schema";
import { createPageFetch } from "@repo/mobile/items/page-fetch";
import { libraryCards } from "@repo/mobile/library/library-view";
import type { LibraryCard } from "@repo/mobile/library/library-view";
import { composeRuntime } from "@repo/mobile/lib/compose-runtime";
import type { AppRuntime } from "@repo/mobile/lib/compose-runtime";
import { openNodeSqlDriver } from "@repo/mobile/lib/node-sql-driver";
import { openPhoneDb } from "@repo/mobile/lib/phone-db";
import type { AttachmentFiles } from "@repo/mobile/notes/attachment-files";
import type { OutboxFiles } from "@repo/mobile/notes/outbox-files";
import { readPage } from "@repo/mobile-editor/reader-mode";
import { parsePage } from "@repo/page-reader/linkedom-page";
import { expect, expectEq } from "./assert";
import { loginDevice, PHONE_BUILD } from "./cloud-account";
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

// the harness holds the phone's credential; the phone never signs out here
const heldCredential = (credential: DeviceCredential) => ({
  clear: () => Promise.resolve(),
  read: () => Promise.resolve(credential),
  write: () => Promise.resolve(),
});

// `credential` is a relaunch: the phone signed in before and reads its Keychain again
export const phoneRuntime = async (
  origin: string,
  dir: string,
  network: { online: boolean },
  credential?: DeviceCredential,
): Promise<AppRuntime> => {
  const login = credential ?? (await loginDevice(origin, PHONE_NAME));
  await mkdir(dir, { recursive: true });
  const fetch: CloudFetch = async (input, init) => {
    if (!network.online) {
      throw new Error("the phone is offline");
    }
    return await globalThis.fetch(input, init);
  };
  const pageFetch = createPageFetch(
    async (input, init) => {
      if (!network.online) {
        throw new Error("the phone is offline");
      }
      return await globalThis.fetch(input, init);
    },
    { acceptLanguage: "en-US,en;q=0.9", userAgent: `inteligir-e2e-phone/${PHONE_BUILD.version}` },
  );
  // two maps, as the app keeps two folders, so neither store finds or clears the other's files.
  return composeRuntime({
    attachments: memoryFiles(),
    build: PHONE_BUILD,
    cloudUrl: origin,
    credentials: heldCredential({ credential: login.credential, deviceId: login.deviceId }),
    db: openPhoneDb(openNodeSqlDriver(path.join(dir, "inteligir.db"))),
    deviceName: PHONE_NAME,
    fill: {
      fetch: pageFetch,
      online: () => network.online,
      // the reader mode's own code, over linkedom where the page has its WebView's DOMParser
      read: async (job) => await Promise.resolve(readPage(job, parsePage)),
      sha256Hex: async (bytes) =>
        await Promise.resolve(createHash("sha256").update(bytes).digest("hex")),
      // no image decoder under node: a JPEG or a PNG is kept as fetched, anything else is no cover
      shrinkCover: async (picture) =>
        await Promise.resolve(
          picture.mediaType === "image/jpeg" || picture.mediaType === "image/png"
            ? { bytes: picture.bytes, mediaType: picture.mediaType }
            : null,
        ),
    },
    newId: randomUUID,
    outboxFiles: memoryFiles(),
    randomBytes: (length) => randomBytes(length),
    retryBaseMs: null,
    sha1: (bytes) => Promise.resolve(createHash("sha1").update(bytes).digest()),
    sync: {
      createClient: (signedIn) =>
        createCloudClient({
          baseUrl: origin,
          build: PHONE_BUILD,
          credential: signedIn.credential,
          fetch,
        }),
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

export const drained = async (phone: AppRuntime, label: string): Promise<void> => {
  await phone.notes.drain();
  const { parked, unsent } = phone.notes.outbox.status.get();
  expectEq(unsent, 0, `${label}: the phone's unsent changes`);
  expectEq(parked.length, 0, `${label}: the phone's parked changes`);
};

export const readPhoneNote = async (phone: AppRuntime, notePath: string): Promise<string> => {
  const read = await phone.notes.readNote(notePath);
  expect(read.ok, `the phone reads ${notePath}: ${read.ok ? "" : read.message}`);
  return read.content;
};

// the card the phone's Library draws for one item, as its All view lists it
export const cardAt = (phone: AppRuntime, wanted: string): LibraryCard | undefined =>
  libraryCards(phone.notes.heldFiles(), {
    kinds: new Set(),
    query: "",
    scope: { kind: "all" },
  }).find((card) => card.path === wanted);
