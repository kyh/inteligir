// the phone's own runtime, the one the app composes, under node against a booted Worker: its
// key-value store and its files in memory, a network the scenario can take away, and a Keychain the
// harness holds. A relaunch is a second runtime over the first one's store and Keychain.
//
// The app signs in through Better Auth's Expo client, which imports React Native and so loads in no
// node process; here a plain fetch calls the same routes as it does, the app's scheme named in
// `expo-origin` and the session cookie the answer set kept in the Keychain.

import { createHash, randomBytes } from "node:crypto";
import { AUTH_API_PATHS } from "@repo/contract/account/account-schema";
import { PHONE_ORIGIN } from "@repo/contract/origin";
import type { V1Client } from "@repo/contract/v1";
import { isOrpcError } from "@repo/contract/v1/errors";
import type { AuthAnswer, PhoneAuth } from "@repo/mobile/auth/phone-auth";
import { composeRuntime } from "@repo/mobile/lib/compose-runtime";
import type { AppRuntime, PhoneLibrary } from "@repo/mobile/lib/compose-runtime";
import { memoryFolder } from "@repo/mobile/test-support/memory-folder";
import { memoryKv } from "@repo/mobile/test-support/memory-kv";
import type { MemoryKv } from "@repo/mobile/test-support/memory-kv";
import { uuidV7 } from "@repo/contract/library/uuid-v7";
import { z } from "zod";
import { expect, expectEq } from "./assert";
import { OWNER, PHONE_BUILD } from "./cloud-account";
import { pollUntil } from "./poll";

const LANDED_DEADLINE_MS = 20_000;

// the system networking stack's user agent, which a native request carries and the account's
// device list names an iPhone by
const PHONE_USER_AGENT = "inteligir/1 CFNetwork/3826.500.111 Darwin/25.0.0";

export type HeldItem = Awaited<ReturnType<V1Client["library"]["items"]["get"]>>;

// what the phone's Keychain holds of its sign-in: the session cookie, null for none
export interface Keychain {
  cookie: string | null;
}

export interface Phone {
  readonly runtime: AppRuntime;
  readonly network: { online: boolean };
  readonly keychain: Keychain;
  readonly storage: MemoryKv;
}

const offline = (): never => {
  throw new TypeError("the phone is offline");
};

const refusalSchema = z.looseObject({ message: z.string() });
const sessionSchema = z.looseObject({ session: z.looseObject({ id: z.string() }) }).nullable();

// what a native client sends back: the name=value of each cookie the answer set
const cookieOf = (response: Response): string | null => {
  const cookie = response.headers
    .getSetCookie()
    .map((setCookie) => setCookie.split(";")[0] ?? "")
    .join("; ");
  return cookie === "" ? null : cookie;
};

const phoneAuth = (origin: string, network: { online: boolean }, keychain: Keychain): PhoneAuth => {
  // a GET carries no body; the session is the one the call names, which a sign-out takes before
  // the Keychain lets it go
  const send = async (
    path: string,
    init: { readonly method: "GET" } | { readonly method: "POST"; readonly body: string },
    cookie: string | null,
  ): Promise<Response> => {
    if (!network.online) {
      offline();
    }
    const headers = new Headers({
      "content-type": "application/json",
      "expo-origin": PHONE_ORIGIN,
      "user-agent": PHONE_USER_AGENT,
    });
    if (cookie !== null) {
      headers.set("cookie", cookie);
    }
    return await fetch(`${origin}${path}`, { ...init, headers });
  };

  const enter = async (path: string, body: string): Promise<AuthAnswer> => {
    let response: Response;
    try {
      response = await send(path, { body, method: "POST" }, keychain.cookie);
    } catch {
      return { kind: "unreachable" };
    }
    if (!response.ok) {
      const refusal = refusalSchema.safeParse(await response.json().catch(() => null));
      return {
        kind: "refused",
        message: refusal.success ? refusal.data.message : null,
        status: response.status,
      };
    }
    await response.arrayBuffer();
    keychain.cookie = cookieOf(response);
    return { kind: "signed-in" };
  };

  return {
    check: async () => {
      try {
        const response = await send("/api/auth/get-session", { method: "GET" }, keychain.cookie);
        if (!response.ok) {
          await response.arrayBuffer();
          return "unknown";
        }
        return sessionSchema.parse(await response.json()) === null ? "ended" : "live";
      } catch {
        return "unknown";
      }
    },
    cookie: async () => await Promise.resolve(keychain.cookie),
    signIn: async (request) => await enter("/api/auth/sign-in/email", JSON.stringify(request)),
    // the cookie goes first and the cloud is told after, unawaited, as the Expo client does
    signOut: async () => {
      const { cookie } = keychain;
      keychain.cookie = null;
      const tell = async (): Promise<void> => {
        try {
          const told = await send("/api/auth/sign-out", { body: "{}", method: "POST" }, cookie);
          await told.arrayBuffer();
        } catch {
          // offline: the session stays listed until another device ends it
        }
      };
      void tell();
      await Promise.resolve();
    },
    signUp: async (request) => await enter(AUTH_API_PATHS.signUp, JSON.stringify(request)),
  };
};

// a device's runtime over `storage`, signed in when `keychain` holds a session a sign-in left; every
// network call fails while `network.online` is false
export const phoneRuntime = async (
  origin: string,
  options: {
    readonly network?: { online: boolean };
    readonly keychain?: Keychain;
    readonly storage?: MemoryKv;
  } = {},
): Promise<Phone> => {
  const network = options.network ?? { online: true };
  const storage = options.storage ?? memoryKv();
  const keychain = options.keychain ?? { cookie: null };
  const runtime = composeRuntime({
    auth: phoneAuth(origin, network, keychain),
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
  return { keychain, network, runtime, storage };
};

// a phone signed in as the account's owner, as its sign-in screen does
export const signedInPhone = async (origin: string): Promise<Phone> => {
  const phone = await phoneRuntime(origin);
  await phone.runtime.login.login(OWNER);
  expectEq(phone.runtime.login.get(), { kind: "idle" }, "the phone's sign-in");
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
