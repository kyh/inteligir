// the phone's own runtime, the one the app composes, under node against a booted Worker: node's
// sqlite in the phone's own file, its files in memory, a network the scenario can take away, a
// Keychain the harness holds, and the editor page's own code where the app runs it in its headless
// WebView: the block merge, and the reader a shared page is read with, over linkedom where the page
// has its WebView's DOM

import { createHash, randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { FillJob } from "@repo/editor-bridge/protocol";
import { createPageFetch } from "@repo/mobile/items/page-fetch";
import { saveShared } from "@repo/mobile/items/share-save";
import { composeRuntime } from "@repo/mobile/lib/compose-runtime";
import type { AppRuntime, CredentialStore, PhoneLibrary } from "@repo/mobile/lib/compose-runtime";
import { openNodeReplicaSql } from "@repo/mobile/lib/node-replica-sql";
import { memoryFolders } from "@repo/mobile/test-support/memory-folders";
import { mergeSides, readPage } from "@repo/mobile-editor/headless-mode";
import { uuidV7 } from "@repo/notes/library/uuid-v7";
import { parsePage } from "@repo/page-reader/linkedom-page";
import { expect, expectEq } from "./assert";
import { OWNER, PHONE_BUILD } from "./cloud-account";
import { pollUntil } from "./poll";

const PHONE_NAME = "E2E Phone";

const LANDED_DEADLINE_MS = 20_000;

type Kept = Parameters<CredentialStore["write"]>[0];

export interface Phone {
  readonly runtime: AppRuntime;
  readonly network: { online: boolean };
  // what the Keychain holds, for a relaunch over the same database
  readonly kept: () => Kept | null;
  readonly dir: string;
}

const offline = (): never => {
  throw new TypeError("the phone is offline");
};

// a device's runtime over its own database in `dir`, signed in when `kept` names a credential a
// sign-in left; every network call fails while `network.online` is false
export const phoneRuntime = async (
  origin: string,
  dir: string,
  options: { readonly network?: { online: boolean }; readonly kept?: Kept | null } = {},
): Promise<Phone> => {
  await mkdir(dir, { recursive: true });
  const network = options.network ?? { online: true };
  let held: Kept | null = options.kept ?? null;
  const runtime = composeRuntime({
    build: PHONE_BUILD,
    clock: {
      after: (ms, run) => {
        const timer = setTimeout(run, ms);
        return () => {
          clearTimeout(timer);
        };
      },
      now: () => Date.now(),
    },
    cloudUrl: origin,
    credentials: {
      clear: async () => {
        held = null;
        await Promise.resolve();
      },
      read: async () => await Promise.resolve(held),
      write: async (credential) => {
        held = credential;
        await Promise.resolve();
      },
    },
    dial: null,
    fetch: async (request) => (network.online ? await globalThis.fetch(request) : offline()),
    folders: memoryFolders(),
    merge: async (sides) => {
      const merged = mergeSides(sides);
      expect(merged !== null, "the editor page's merge took the block");
      return await Promise.resolve(merged);
    },
    newId: () => uuidV7(Date.now(), randomBytes(16)),
    openSql: async () => await Promise.resolve(openNodeReplicaSql(path.join(dir, "inteligir.db"))),
    sha256Hex: async (bytes) =>
      await Promise.resolve(createHash("sha256").update(bytes).digest("hex")),
    shrinkCover: async () => await Promise.resolve(null),
  });
  await runtime.start();
  return { dir, kept: () => held, network, runtime };
};

// the phone signed in as the account's owner, as its sign-in screen does
export const signedInPhone = async (
  origin: string,
  dir: string,
  name = PHONE_NAME,
): Promise<Phone> => {
  const phone = await phoneRuntime(origin, dir);
  await phone.runtime.login.login({
    deviceName: name,
    email: OWNER.email,
    password: OWNER.password,
  });
  expectEq(phone.runtime.login.get(), { kind: "idle" }, `${name}'s sign-in`);
  return phone;
};

export const libraryOf = (phone: Phone): PhoneLibrary => {
  const session = phone.runtime.session.get();
  expect(session.kind === "signed-in", `the phone is signed in, not ${session.kind}`);
  return session.library;
};

// a pass, and every write the phone holds landed
export const drained = async (phone: Phone, label: string): Promise<void> => {
  const { replica } = libraryOf(phone);
  await replica.sync();
  const { parked, unsent } = replica.status();
  expectEq(parked, [], `${label}: the phone's refused changes`);
  expectEq(unsent, 0, `${label}: the phone's unsent changes`);
};

// until the phone's replica reads an item that answers `ready`
export const untilItem = async (
  phone: Phone,
  itemId: string,
  ready: (item: Awaited<ReturnType<PhoneLibrary["replica"]["item"]>>) => boolean,
  describe: string,
) => {
  const { replica } = libraryOf(phone);
  return await pollUntil(
    async () => {
      await replica.sync();
      return await replica.item(itemId);
    },
    ready,
    { deadlineMs: LANDED_DEADLINE_MS, describe: () => describe },
  );
};

// the phone's share sheet: the page read on the phone, as its headless page reads it
export const shareFromPhone = async (phone: Phone, shared: Parameters<typeof saveShared>[1]) => {
  const fetchOnPhone = createPageFetch(
    async (input, init) => (phone.network.online ? await globalThis.fetch(input, init) : offline()),
    { acceptLanguage: "en-US,en;q=0.9", userAgent: `inteligir-e2e-phone/${PHONE_BUILD.version}` },
  );
  return await saveShared(
    {
      newBlockId: () => randomBytes(12).toString("hex"),
      ports: {
        fetch: fetchOnPhone,
        read: async (job: FillJob) => await Promise.resolve(readPage(job, parsePage)),
      },
      replica: libraryOf(phone).replica,
    },
    shared,
  );
};
