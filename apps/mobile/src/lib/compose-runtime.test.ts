// The phone's runtime as the app composes it, over a key-value store and a folder in memory, an
// auth the suite holds, and the contract's fake cell for the account: every move between signed in
// and signed out, what each one keeps and clears, what an answer of what moved asks again, and a
// conversation followed over the phone's own wire.

import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { dehydrate, focusManager, QueryObserver } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { createFakeCell } from "@repo/contract/test-support/fake-cell";
import type { FakeCell, FakeDevice } from "@repo/contract/test-support/fake-cell";
import { paragraph } from "@repo/contract/test-support/library-items";
import { afterEach, describe, expect, it } from "vitest";
import { deferred } from "@repo/contract/deferred";
import { fakePhoneAuth, KEPT_SESSION } from "../test-support/fake-phone-auth";
import type { FakePhoneAuth } from "../test-support/fake-phone-auth";
import { memoryFolder } from "../test-support/memory-folder";
import type { MemoryFolder } from "../test-support/memory-folder";
import { memoryKv } from "@repo/client/test-support/memory-kv";
import { threadQueries } from "@repo/client/thread-queries";
import type { MemoryKv } from "@repo/client/test-support/memory-kv";
import { composeRuntime, SIGNED_OUT_ELSEWHERE } from "./compose-runtime";
import type { AppRuntime, PhoneLibrary } from "./compose-runtime";

const SIGN_IN = { email: "ada@example.com", password: "a long password" };

const PAGE = "https://example.com/later";
const NOTE = "0190a000-0000-7000-8000-0000000000a1";

// a folder that refuses the next clear once told to, as a full disk refuses a wipe's
const refusingOnce = (folder: MemoryFolder) => {
  let armed = false;
  const port: MemoryFolder = {
    ...folder,
    clear: async () => {
      if (armed) {
        armed = false;
        throw new Error("database or disk is full");
      }
      await folder.clear();
    },
  };
  return {
    port,
    refuseNext: () => {
      armed = true;
    },
  };
};

// a fresh UUIDv7 each time, as the phone mints its ids
const idSource = () => {
  let next = 0;
  return (): string => {
    next += 1;
    return `0190a000-0000-7000-8000-${next.toString(16).padStart(12, "0")}`;
  };
};

interface PhoneOptions {
  readonly keys: FakePhoneAuth;
  readonly storage?: MemoryKv;
  readonly folder?: MemoryFolder;
  readonly fetch?: (request: Request) => Promise<Response>;
}

const runtimeOver = (cell: FakeCell, options: PhoneOptions) => {
  const network = cell.device("phone");
  const storage = options.storage ?? memoryKv();
  const runtime = composeRuntime({
    auth: options.keys.auth,
    build: { platform: "mobile", version: "1.0.0" },
    cloudUrl: "https://cell.test",
    fetch: options.fetch ?? (async (request) => await network.transport.fetch(request)),
    folder: options.folder ?? memoryFolder(),
    measurePicture: async () => await Promise.resolve(null),
    newBlockId: idSource(),
    newId: idSource(),
    sha256Hex: async (bytes) =>
      await Promise.resolve(createHash("sha256").update(bytes).digest("hex")),
    storage,
  });
  return { network, runtime, storage };
};

const signedIn = (runtime: AppRuntime): PhoneLibrary => {
  const session = runtime.session.get();
  if (session.kind !== "signed-in") {
    throw new Error(`the phone is ${session.kind}`);
  }
  return session.library;
};

const sharesKept = (storage: MemoryKv): string[] =>
  [...storage.held.keys()].filter((key) => key.startsWith("share:"));

// a note the account holds, written by another device
const noteOnTheMac = async (cell: FakeCell): Promise<void> => {
  await cell.device("mac").client.library.items.create({
    blocks: [{ block: paragraph("p1", "first"), section: "note" }],
    folderId: null,
    id: NOTE,
    opId: "0190a000-0000-7000-8000-0000000000b1",
    savedAt: 1_700_000_000_000,
    tags: [],
    title: "Plans",
  });
};

// a share kept while the cloud cannot be reached, so it waits
const shareWaiting = async (library: PhoneLibrary, network: FakeDevice): Promise<void> => {
  network.setOffline(true);
  const kept = await library.shares.keep({ kind: "link", note: null, title: null, url: PAGE });
  if (kept === null) {
    throw new Error("the outbox refused a share while signed in");
  }
  await expect(library.shares.deliver(kept.opId)).resolves.toBeNull();
};

describe("the phone's runtime", () => {
  it("is signed out with nothing kept, and says nothing about it", async () => {
    const { runtime } = runtimeOver(createFakeCell(), { keys: fakePhoneAuth() });
    await runtime.start();
    expect(runtime.session.get()).toStrictEqual({ kind: "signed-out", notice: null });
  });

  it("keeps a sign-in's session, then reads the account's library", async () => {
    const cell = createFakeCell();
    await noteOnTheMac(cell);
    const keys = fakePhoneAuth();
    const { runtime } = runtimeOver(cell, { keys });
    await runtime.start();
    await runtime.login.login(SIGN_IN);

    expect(runtime.login.get()).toStrictEqual({ kind: "idle" });
    expect(keys.held()).toBe(KEPT_SESSION);
    const { queries } = signedIn(runtime);
    await expect(
      runtime.queryClient.query(queries.library.listing.titles.queryOptions()),
    ).resolves.toStrictEqual({ targets: [{ id: NOTE, title: "Plans" }] });
  });

  it("fails a sign-in whose session the Keychain would not keep, and signs out again", async () => {
    const keys = fakePhoneAuth();
    keys.keepNothing();
    const { runtime } = runtimeOver(createFakeCell(), { keys });
    await runtime.start();
    await runtime.login.login(SIGN_IN);

    expect(runtime.login.get()).toStrictEqual({
      kind: "failed",
      message: "This iPhone couldn't keep your sign-in.",
    });
    expect(runtime.session.get().kind).toBe("signed-out");
    expect(keys.calls).toStrictEqual(["signIn", "signOut"]);
  });

  it("starts the cache, the files and the shares over at a sign-in, since they may be another account's", async () => {
    const cell = createFakeCell();
    const keys = fakePhoneAuth(KEPT_SESSION);
    const folder = memoryFolder();
    const first = runtimeOver(cell, { folder, keys });
    await first.runtime.start();
    await shareWaiting(signedIn(first.runtime), first.network);
    await folder.write("cached", new Uint8Array([1, 2, 3]));
    first.runtime.queryClient.setQueryData(["kept"], "the last account's");
    await keys.auth.signOut();

    const second = runtimeOver(cell, { folder, keys, storage: first.storage });
    await second.runtime.start();
    await second.runtime.login.login(SIGN_IN);
    expect(signedIn(second.runtime).shares.waiting.get()).toStrictEqual([]);
    expect(sharesKept(second.storage)).toStrictEqual([]);
    expect(folder.held()).toStrictEqual([]);
    expect(second.runtime.queryClient.getQueryData(["kept"])).toBeUndefined();
  });

  it("keeps a share waiting across a relaunch, and lands it once the cloud can be reached", async () => {
    const cell = createFakeCell();
    const keys = fakePhoneAuth(KEPT_SESSION);
    const first = runtimeOver(cell, { keys });
    await first.runtime.start();
    await shareWaiting(signedIn(first.runtime), first.network);

    const again = runtimeOver(cell, { keys, storage: first.storage });
    again.network.setOffline(true);
    again.runtime.setReach({ online: false });
    await again.runtime.start();
    const library = signedIn(again.runtime);
    expect(library.shares.waiting.get()).toHaveLength(1);

    again.network.setOffline(false);
    again.runtime.setReach({ online: true });
    await expect.poll(() => library.shares.waiting.get()).toStrictEqual([]);
    expect([...cell.items().values()].map((item) => item.fields.url)).toStrictEqual([PAGE]);
  });

  it("leaves the account when the cloud no longer takes its session, and says why", async () => {
    const cell = createFakeCell();
    const keys = fakePhoneAuth(KEPT_SESSION);
    const { network, runtime, storage } = runtimeOver(cell, { keys });
    await runtime.start();
    await shareWaiting(signedIn(runtime), network);
    network.setOffline(false);

    cell.signOut();
    await signedIn(runtime).shares.flush();
    await expect
      .poll(() => runtime.session.get())
      .toStrictEqual({ kind: "signed-out", notice: SIGNED_OUT_ELSEWHERE });
    expect(keys.held()).toBeNull();
    expect(sharesKept(storage)).toStrictEqual([]);
  });

  it("leaves the account a launch finds its session ended in, and says why", async () => {
    const keys = fakePhoneAuth(KEPT_SESSION);
    keys.checks("ended");
    const { runtime, storage } = runtimeOver(createFakeCell(), { keys });
    await storage.setItem("library-cache", "the last launch's");
    await runtime.start();

    await expect
      .poll(() => runtime.session.get())
      .toStrictEqual({ kind: "signed-out", notice: SIGNED_OUT_ELSEWHERE });
    expect(keys.held()).toBeNull();
    expect([...storage.held.keys()]).toStrictEqual([]);
  });

  it("stays signed in when its session cannot be read, and asks again on each return to the front", async () => {
    const keys = fakePhoneAuth(KEPT_SESSION);
    keys.checks("unknown");
    const { runtime } = runtimeOver(createFakeCell(), { keys });
    await runtime.start();
    await expect.poll(() => keys.calls).toStrictEqual(["check"]);
    expect(runtime.session.get().kind).toBe("signed-in");

    keys.checks("ended");
    runtime.setReach({ front: false });
    runtime.setReach({ front: true });
    await expect
      .poll(() => runtime.session.get())
      .toStrictEqual({ kind: "signed-out", notice: SIGNED_OUT_ELSEWHERE });
    expect(keys.calls).toStrictEqual(["check", "check", "signOut"]);
  });

  it("asks before a sign-out discards saves waiting, and signs out when told", async () => {
    const cell = createFakeCell();
    const keys = fakePhoneAuth(KEPT_SESSION);
    const { network, runtime, storage } = runtimeOver(cell, { keys });
    await runtime.start();
    await shareWaiting(signedIn(runtime), network);

    await expect(runtime.logout()).resolves.toStrictEqual({ kind: "waiting", saves: 1 });
    expect(runtime.session.get().kind).toBe("signed-in");

    network.setOffline(false);
    await expect(runtime.logout({ discardWaiting: true })).resolves.toStrictEqual({
      kind: "signed-out",
    });
    expect(runtime.session.get()).toStrictEqual({ kind: "signed-out", notice: null });
    expect(keys.held()).toBeNull();
    expect(sharesKept(storage)).toStrictEqual([]);
    expect(keys.calls).toContain("signOut");
  });

  it("signs out at once though the cloud never answers", async () => {
    const { runtime } = runtimeOver(createFakeCell(), {
      // the cloud never answers
      fetch: async () => await deferred<Response>().promise,
      keys: fakePhoneAuth(KEPT_SESSION),
    });
    await runtime.start();

    await expect(runtime.logout()).resolves.toStrictEqual({ kind: "signed-out" });
    expect(runtime.session.get().kind).toBe("signed-out");
  });

  it("stays signed in, working and the account's, when the phone cannot take its copy away", async () => {
    const cell = createFakeCell();
    await noteOnTheMac(cell);
    const keys = fakePhoneAuth(KEPT_SESSION);
    const folder = refusingOnce(memoryFolder());
    const { runtime } = runtimeOver(cell, { folder: folder.port, keys });
    await runtime.start();
    const before = signedIn(runtime);

    folder.refuseNext();
    await expect(runtime.logout()).resolves.toStrictEqual({
      kind: "failed",
      message: "database or disk is full",
    });
    // the phone is still the account's, and its library opened again over what the phone holds
    expect(keys.calls).not.toContain("signOut");
    expect(keys.held()).toBe(KEPT_SESSION);
    const after = signedIn(runtime);
    expect(after).not.toBe(before);
    await expect(
      runtime.queryClient.query(after.queries.library.listing.titles.queryOptions()),
    ).resolves.toStrictEqual({ targets: [{ id: NOTE, title: "Plans" }] });

    // and a refusal it hears later still ends the sign-in
    cell.signOut();
    await expect(after.client.library.changes({})).rejects.toThrow(/sign/u);
    await expect
      .poll(() => runtime.session.get())
      .toStrictEqual({ kind: "signed-out", notice: SIGNED_OUT_ELSEWHERE });
    expect(keys.held()).toBeNull();
  });

  it("gives a second sign-out asked while the first clears the first's outcome", async () => {
    const keys = fakePhoneAuth(KEPT_SESSION);
    const folder = refusingOnce(memoryFolder());
    const { runtime } = runtimeOver(createFakeCell(), { folder: folder.port, keys });
    await runtime.start();

    folder.refuseNext();
    const failed = { kind: "failed", message: "database or disk is full" };
    await expect(Promise.all([runtime.logout(), runtime.logout()])).resolves.toStrictEqual([
      failed,
      failed,
    ]);
    expect(runtime.session.get().kind).toBe("signed-in");
    expect(keys.calls).not.toContain("signOut");
  });

  it("asks the session once the app is both in front and online again, however many times it is told", async () => {
    const keys = fakePhoneAuth(KEPT_SESSION);
    keys.checks("unknown");
    const { runtime } = runtimeOver(createFakeCell(), { keys });
    await runtime.start();
    runtime.setReach({ front: true });
    expect(keys.calls).toStrictEqual(["check"]);
    runtime.setReach({ front: false });
    runtime.setReach({ online: false });
    runtime.setReach({ front: true });
    expect(runtime.reach.get()).toBe(false);
    expect(keys.calls).toStrictEqual(["check"]);
    runtime.setReach({ online: true });
    runtime.setReach({ online: true });
    expect(keys.calls).toStrictEqual(["check", "check"]);
  });

  it("does nothing on a return to the front while signed out", async () => {
    const keys = fakePhoneAuth();
    const cell = createFakeCell();
    const { runtime } = runtimeOver(cell, { keys });
    await runtime.start();
    runtime.setReach({ front: false });
    runtime.setReach({ front: true });
    await delay(20);
    expect(keys.calls).toStrictEqual([]);
    expect(cell.calls).toStrictEqual([]);
  });

  it("is signed out of a sign-in the cloud ended though its copy would not go, and clears it at the next launch", async () => {
    const cell = createFakeCell();
    const keys = fakePhoneAuth(KEPT_SESSION);
    const memory = memoryFolder();
    const folder = refusingOnce(memory);
    const first = runtimeOver(cell, { folder: folder.port, keys });
    await first.runtime.start();
    await memory.write("cached", new Uint8Array([1, 2, 3]));

    cell.signOut();
    folder.refuseNext();
    await expect(signedIn(first.runtime).client.library.changes({})).rejects.toThrow(/sign/u);
    await expect
      .poll(() => first.runtime.session.get())
      .toStrictEqual({
        kind: "signed-out",
        notice: `${SIGNED_OUT_ELSEWHERE} The copy on this iPhone couldn't be removed yet; Inteligir tries again the next time it opens: database or disk is full`,
      });
    expect(keys.held()).toBe(KEPT_SESSION);
    expect(memory.held()).toStrictEqual(["cached"]);

    // what moved is the next launch's first call, which hears the refusal
    const again = runtimeOver(cell, { folder: memory, keys });
    await again.runtime.start();
    await expect
      .poll(() => again.runtime.session.get())
      .toStrictEqual({ kind: "signed-out", notice: SIGNED_OUT_ELSEWHERE });
    expect(keys.held()).toBeNull();
    expect(memory.held()).toStrictEqual([]);
  });

  it("fails the launch when the phone's store will not read", async () => {
    const storage = memoryKv();
    const { runtime } = runtimeOver(createFakeCell(), {
      keys: fakePhoneAuth(KEPT_SESSION),
      storage: {
        ...storage,
        getAllKeys: async () => {
          await Promise.resolve();
          throw new Error("disk I/O error");
        },
      },
    });
    await runtime.start();
    expect(runtime.session.get()).toStrictEqual({ kind: "failed", message: "disk I/O error" });
  });
});

afterEach(() => {
  focusManager.setFocused(undefined);
});

// a phone open on the account's library, a note's read held, the items each answer named, and how
// often it asked what moved
const askingPhone = async () => {
  const cell = createFakeCell();
  await noteOnTheMac(cell);
  const { runtime } = runtimeOver(cell, { keys: fakePhoneAuth(KEPT_SESSION) });
  // the root's provider mounts the client, which is what lets a return to the front ask
  runtime.queryClient.mount();
  await runtime.start();
  const asks = (): number => cell.calls.filter((call) => call === "phone library/changes").length;
  await expect.poll(asks).toBe(1);
  const library = signedIn(runtime);
  const moved: (ReadonlySet<string> | null)[] = [];
  library.onItems((items) => {
    moved.push(items);
  });
  // a note's read, filed as the cache files it whatever the query reads
  const read: QueryKey = library.queries.library.items.get.queryKey({ input: { id: NOTE } });
  runtime.queryClient.setQueryData(read, "held");
  const asked = (): boolean => runtime.queryClient.getQueryState(read)?.isInvalidated === true;
  return { asked, asks, cell, moved, runtime };
};

describe("what moved, as the phone asks it", () => {
  it("asks once its library opens, and again as the app comes back in front, reading again what another device changed", async () => {
    const { asked, asks, cell, moved } = await askingPhone();
    focusManager.setFocused(false);
    await cell.device("mac").client.library.items.organize({ ids: [NOTE], title: "Later" });
    expect(asked()).toBe(false);

    focusManager.setFocused(true);
    await expect.poll(asks).toBe(2);
    await expect.poll(asked).toBe(true);
    expect(moved).toStrictEqual([new Set([NOTE])]);
  });

  it("stops asking once signed out", async () => {
    const { asks, runtime } = await askingPhone();
    await expect(runtime.logout()).resolves.toStrictEqual({ kind: "signed-out" });
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await delay(20);
    expect(asks()).toBe(1);
  });
});

describe("a conversation, as the phone follows it", () => {
  const THREAD = "0190a000-0000-7000-8000-0000000000c1";

  it("streams a thread's events over its own wire as they land, and picks up after the last one held when the screen opens again", async () => {
    const cell = createFakeCell();
    cell.threadEvent(THREAD, { text: "File my reading.", type: "user.message" });
    const network = cell.device("phone");
    const followed: Request[] = [];
    const { runtime } = runtimeOver(cell, {
      fetch: async (request) => {
        if (request.url.endsWith("/library/agent/events")) {
          followed.push(request.clone());
        }
        return await network.transport.fetch(request);
      },
      keys: fakePhoneAuth(KEPT_SESSION),
    });
    await runtime.start();
    const { client, queries } = signedIn(runtime);
    const shown = new QueryObserver(
      runtime.queryClient,
      threadQueries({ client, orpc: queries }).threadEvents(THREAD),
    );
    const types = () => shown.getCurrentResult().data?.rows.map((row) => row.type) ?? [];
    const stop = shown.subscribe(() => {
      // the thread's screen draws what it holds
    });
    await expect.poll(types).toStrictEqual(["user.message"]);
    expect(followed[0]?.headers.get("cookie")).toBe(KEPT_SESSION);

    cell.threadEvent(THREAD, { text: "Filed 3 items.", type: "agent.message" });
    await expect.poll(types).toStrictEqual(["user.message", "agent.message"]);

    // the screen closes, the turn ends meanwhile, and the screen opens again
    stop();
    cell.threadEvent(THREAD, { reason: "done", turn: 1, type: "turn.ended" });
    const reopened = shown.subscribe(() => {
      // the thread's screen draws what it holds
    });
    await expect.poll(types).toStrictEqual(["user.message", "agent.message", "turn.ended"]);
    expect(followed.at(-1)?.headers.get("last-event-id")).toBe("1:1:0");
    reopened();
  });
});

describe("the cache the phone keeps between launches", () => {
  it("keeps what was read, but no file's address and no write", async () => {
    const { runtime } = runtimeOver(createFakeCell(), { keys: fakePhoneAuth() });
    const { queryClient } = runtime;
    queryClient.setQueryData(["read"], "kept");
    await queryClient.query({
      meta: { persist: false },
      queryFn: async () => await Promise.resolve("memory://cached"),
      queryKey: ["file"],
    });
    queryClient.getMutationCache().build(queryClient, { mutationKey: ["write"] });

    const kept = dehydrate(queryClient, runtime.persistOptions.dehydrateOptions);
    expect(kept.queries.map((query) => query.queryKey)).toStrictEqual([["read"]]);
    expect(kept.mutations).toStrictEqual([]);
  });
});
