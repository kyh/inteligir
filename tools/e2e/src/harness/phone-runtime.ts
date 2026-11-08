// the phone's own runtime, the one the app composes, under node against a booted Worker: its
// key-value store and its files in memory, a network the scenario can take away, and a Keychain the
// harness holds. A relaunch is a second runtime over the first one's store and Keychain.

import { createHash, randomBytes } from "node:crypto";
import type { V1Client } from "@repo/contract/cloud/v1";
import { isOrpcError } from "@repo/contract/cloud/v1/errors";
import { composeRuntime } from "@repo/mobile/lib/compose-runtime";
import type { AppRuntime, CredentialStore, PhoneLibrary } from "@repo/mobile/lib/compose-runtime";
import { memoryFolder } from "@repo/mobile/test-support/memory-folder";
import { memoryKv } from "@repo/mobile/test-support/memory-kv";
import type { MemoryKv } from "@repo/mobile/test-support/memory-kv";
import { uuidV7 } from "@repo/notes/library/uuid-v7";
import { expect, expectEq } from "./assert";
import { OWNER, PHONE_BUILD } from "./cloud-account";
import { pollUntil } from "./poll";

const PHONE_NAME = "E2E Phone";

const LANDED_DEADLINE_MS = 20_000;

type Kept = Parameters<CredentialStore["write"]>[0];

export type HeldItem = Awaited<ReturnType<V1Client["library"]["items"]["get"]>>;

export interface Phone {
  readonly runtime: AppRuntime;
  readonly network: { online: boolean };
  // what the Keychain holds, for a relaunch over the same store
  readonly kept: () => Kept | null;
  readonly storage: MemoryKv;
}

const offline = (): never => {
  throw new TypeError("the phone is offline");
};

// a device's runtime over `storage`, signed in when `kept` names a credential a sign-in left; every
// network call fails while `network.online` is false
export const phoneRuntime = async (
  origin: string,
  options: {
    readonly network?: { online: boolean };
    readonly kept?: Kept | null;
    readonly storage?: MemoryKv;
  } = {},
): Promise<Phone> => {
  const network = options.network ?? { online: true };
  const storage = options.storage ?? memoryKv();
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
    folder: memoryFolder(),
    newBlockId: () => randomBytes(12).toString("hex"),
    newId: () => uuidV7(Date.now(), randomBytes(16)),
    sha256Hex: async (bytes) =>
      await Promise.resolve(createHash("sha256").update(bytes).digest("hex")),
    shrinkCover: async () => await Promise.resolve(null),
    storage,
  });
  await runtime.start();
  return { kept: () => held, network, runtime, storage };
};

// the phone signed in as the account's owner, as its sign-in screen does
export const signedInPhone = async (origin: string, name = PHONE_NAME): Promise<Phone> => {
  const phone = await phoneRuntime(origin);
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

// the item as the cloud holds it now, null for one it holds none of
const itemNow = async (phone: Phone, id: string): Promise<HeldItem | null> => {
  try {
    return await libraryOf(phone).client.library.items.get({ id });
  } catch (error) {
    if (isOrpcError(error) && error.defined && error.code === "NOT_FOUND") {
      return null;
    }
    throw error;
  }
};

// until the device reads an item that answers `ready`
export const untilItem = async (
  phone: Phone,
  itemId: string,
  ready: (item: HeldItem | null) => boolean,
  describe: string,
): Promise<HeldItem | null> =>
  await pollUntil(async () => await itemNow(phone, itemId), ready, {
    deadlineMs: LANDED_DEADLINE_MS,
    describe: (last) => `${describe}: ${JSON.stringify(last?.fields ?? null)}`,
  });

// the phone's share sheet: the share kept before it is sent, then sent, as the share inbox does
export const shareFromPhone = async (
  phone: Phone,
  shared: Parameters<PhoneLibrary["shares"]["keep"]>[0],
) => {
  const { shares } = libraryOf(phone);
  const kept = await shares.keep(shared);
  expect(kept !== null, "the phone keeps the share while signed in");
  return await shares.deliver(kept.opId);
};
