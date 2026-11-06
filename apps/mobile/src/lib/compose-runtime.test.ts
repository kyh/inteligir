// The phone's runtime as the app composes it, over node's sqlite, its files in memory, a Keychain
// the suite holds, and the replica engine's fake cell for the account: every move between signed
// in and signed out, the wipe each one owes, and the credential's own failures.

import { createHash } from "node:crypto";
import { createFakeCell } from "@repo/library-replica/test-support/fake-cell";
import type { FakeCell } from "@repo/library-replica/test-support/fake-cell";
import type { ReplicaSql } from "@repo/library-replica/replica-ports";
import { idSource, keepBoth, openDevice } from "@repo/library-replica/test-support/replica-harness";
import { describe, expect, it } from "vitest";
import type { KeptCredential } from "../credential/credential-codec";
import { memoryFolders } from "../test-support/memory-folders";
import { composeRuntime, SIGNED_OUT_ELSEWHERE } from "./compose-runtime";
import type { AppRuntime, CredentialStore, PhoneLibrary } from "./compose-runtime";
import { openNodeReplicaSql } from "./node-replica-sql";

const SIGN_IN = {
  deviceName: "Ada's iPhone",
  email: "ada@example.com",
  password: "a long password",
};

// the Keychain as the suite holds it: what it keeps, and one that refuses every write
const keychain = (kept: KeptCredential | null = null) => {
  let held = kept;
  let refusing = false;
  const store: CredentialStore = {
    clear: async () => {
      held = null;
      await Promise.resolve();
    },
    read: async () => await Promise.resolve(held),
    write: async (credential) => {
      if (refusing) {
        throw new Error("the Keychain is locked");
      }
      held = credential;
      await Promise.resolve();
    },
  };
  return {
    held: () => held,
    refuse: () => {
      refusing = true;
    },
    store,
  };
};

// a database that refuses the next transaction once told to, as a full disk refuses a wipe's
const refusingOnce = (sql: ReplicaSql) => {
  let armed = false;
  const port: ReplicaSql = {
    all: sql.all,
    exclusive: async (work) => {
      if (armed) {
        armed = false;
        throw new Error("database or disk is full");
      }
      return await sql.exclusive(work);
    },
    run: sql.run,
  };
  return {
    port,
    refuseNext: () => {
      armed = true;
    },
  };
};

// a clock whose timers never fire: the suite runs every pass itself
const stillClock = {
  after: () => () => {
    // nothing was scheduled
  },
  now: () => 1_700_000_200_000,
};

const runtimeOver = (
  cell: FakeCell,
  options: { readonly sql: ReplicaSql; readonly keys: ReturnType<typeof keychain> },
) => {
  const network = cell.device("phone");
  const runtime = composeRuntime({
    build: { platform: "mobile", version: "1.0.0" },
    clock: stillClock,
    cloudUrl: "https://cell.test",
    credentials: options.keys.store,
    dial: null,
    fetch: async (request) => await network.transport.fetch(request),
    folders: memoryFolders(),
    merge: keepBoth,
    newId: idSource(7),
    openSql: async () => await Promise.resolve(options.sql),
    sha256Hex: async (bytes) =>
      await Promise.resolve(createHash("sha256").update(bytes).digest("hex")),
    shrinkCover: async () => await Promise.resolve(null),
  });
  return { network, runtime };
};

const signedIn = (runtime: AppRuntime): PhoneLibrary => {
  const session = runtime.session.get();
  if (session.kind !== "signed-in") {
    throw new Error(`the phone is ${session.kind}`);
  }
  return session.library;
};

const titles = (library: PhoneLibrary): string[] =>
  library.replica
    .listing({ deleted: false, limit: 100, offset: 0, sort: "title" })
    .items.map((row) => row.title);

// a note the account holds, written by another device
const noteOnTheMac = async (cell: FakeCell, title: string): Promise<void> => {
  const mac = await openDevice(cell, "mac");
  await mac.replica.createNote({ blocks: [], folderId: null, tags: [], title });
  await mac.replica.sync();
  await mac.replica.close();
};

const KEPT: KeptCredential = {
  credential: `igd_${"9".repeat(64)}`,
  deviceId: "device-0",
  email: "ada@example.com",
};

describe("the phone's runtime", () => {
  it("is signed out with nothing kept, and says nothing about it", async () => {
    const cell = createFakeCell();
    const { runtime } = runtimeOver(cell, {
      keys: keychain(),
      sql: openNodeReplicaSql(":memory:"),
    });
    await runtime.start();
    expect(runtime.session.get()).toStrictEqual({ kind: "signed-out", notice: null });
  });

  it("keeps a sign-in's credential and whose library it is, then pulls the library", async () => {
    const cell = createFakeCell();
    await noteOnTheMac(cell, "Plans");
    const keys = keychain();
    const { runtime } = runtimeOver(cell, { keys, sql: openNodeReplicaSql(":memory:") });
    await runtime.start();
    await runtime.login.login(SIGN_IN);

    expect(runtime.login.get()).toStrictEqual({ kind: "idle" });
    expect(keys.held()).toMatchObject({ email: "ada@example.com" });
    const library = signedIn(runtime);
    expect(library.email).toBe("ada@example.com");
    await library.replica.sync();
    expect(titles(library)).toStrictEqual(["Plans"]);
  });

  it("fails a sign-in whose credential the Keychain would not keep, and lets that device go", async () => {
    const cell = createFakeCell();
    const keys = keychain();
    keys.refuse();
    const { runtime } = runtimeOver(cell, { keys, sql: openNodeReplicaSql(":memory:") });
    await runtime.start();
    await runtime.login.login(SIGN_IN);

    expect(runtime.login.get()).toStrictEqual({
      kind: "failed",
      message: "This iPhone couldn't keep your sign-in: the Keychain is locked",
    });
    expect(runtime.session.get().kind).toBe("signed-out");
    expect(cell.calls).toContain("phone account/signOut");
  });

  it("starts the database over at a sign-in, since it may hold another account's", async () => {
    const cell = createFakeCell();
    const sql = openNodeReplicaSql(":memory:");
    const earlier = runtimeOver(cell, { keys: keychain(KEPT), sql });
    await earlier.runtime.start();
    earlier.network.setOffline(true);
    await signedIn(earlier.runtime).replica.createNote({
      blocks: [],
      folderId: null,
      tags: [],
      title: "Left behind",
    });
    expect(signedIn(earlier.runtime).replica.status().unsent).toBe(1);
    await signedIn(earlier.runtime).replica.close();

    // the Keychain lost what it kept, the database did not
    const { runtime } = runtimeOver(cell, { keys: keychain(), sql });
    await runtime.start();
    await runtime.login.login(SIGN_IN);
    const library = signedIn(runtime);
    expect(library.replica.status().unsent).toBe(0);
    expect(titles(library)).toStrictEqual([]);
  });

  it("opens what the phone holds at a relaunch, offline", async () => {
    const cell = createFakeCell();
    await noteOnTheMac(cell, "Plans");
    const sql = openNodeReplicaSql(":memory:");
    const first = runtimeOver(cell, { keys: keychain(KEPT), sql });
    await first.runtime.start();
    await signedIn(first.runtime).replica.sync();
    await signedIn(first.runtime).replica.close();

    const again = runtimeOver(cell, { keys: keychain(KEPT), sql });
    again.network.setOffline(true);
    await again.runtime.start();
    expect(titles(signedIn(again.runtime))).toStrictEqual(["Plans"]);
  });

  it("pulls the library again for a credential whose database is empty", async () => {
    const cell = createFakeCell();
    await noteOnTheMac(cell, "Plans");
    const { runtime } = runtimeOver(cell, {
      keys: keychain(KEPT),
      sql: openNodeReplicaSql(":memory:"),
    });
    await runtime.start();
    const library = signedIn(runtime);
    expect(titles(library)).toStrictEqual([]);
    await library.replica.sync();
    expect(titles(library)).toStrictEqual(["Plans"]);
  });

  it("leaves the account when the cloud no longer takes its credential, and says why", async () => {
    const cell = createFakeCell();
    await noteOnTheMac(cell, "Plans");
    const sql = openNodeReplicaSql(":memory:");
    const keys = keychain(KEPT);
    const { runtime } = runtimeOver(cell, { keys, sql });
    await runtime.start();
    const library = signedIn(runtime);
    await library.replica.sync();

    cell.signOut();
    await library.replica.sync();
    await expect
      .poll(() => runtime.session.get())
      .toStrictEqual({
        kind: "signed-out",
        notice: SIGNED_OUT_ELSEWHERE,
      });
    expect(keys.held()).toBeNull();
    await expect(sql.all("SELECT id FROM items", [])).resolves.toStrictEqual([]);
  });

  it("asks before a sign-out discards unsent changes, and lets the device go when told", async () => {
    const cell = createFakeCell();
    const keys = keychain(KEPT);
    const { network, runtime } = runtimeOver(cell, { keys, sql: openNodeReplicaSql(":memory:") });
    await runtime.start();
    network.setOffline(true);
    await signedIn(runtime).replica.createNote({
      blocks: [],
      folderId: null,
      tags: [],
      title: "Unsent",
    });

    await expect(runtime.logout()).resolves.toStrictEqual({ edits: 1, kind: "unsent" });
    expect(runtime.session.get().kind).toBe("signed-in");

    network.setOffline(false);
    await expect(runtime.logout({ discardUnsent: true })).resolves.toStrictEqual({
      kind: "signed-out",
    });
    expect(runtime.session.get()).toStrictEqual({ kind: "signed-out", notice: null });
    expect(keys.held()).toBeNull();
    expect(cell.calls).toContain("phone account/signOut");
  });

  it("stays signed in, working and the account's, when the phone cannot take its copy away", async () => {
    const cell = createFakeCell();
    const keys = keychain(KEPT);
    const db = refusingOnce(openNodeReplicaSql(":memory:"));
    const { network, runtime } = runtimeOver(cell, { keys, sql: db.port });
    await runtime.start();
    network.setOffline(true);
    const before = signedIn(runtime);
    await before.replica.createNote({ blocks: [], folderId: null, tags: [], title: "Unsent" });
    await before.replica.sync();
    network.setOffline(false);

    db.refuseNext();
    await expect(runtime.logout({ discardUnsent: true })).resolves.toStrictEqual({
      kind: "failed",
      message: "database or disk is full",
    });
    // the device is still the account's, and its library opened again over what the phone holds
    expect(cell.calls).not.toContain("phone account/signOut");
    expect(keys.held()).toStrictEqual(KEPT);
    const after = signedIn(runtime);
    expect(after).not.toBe(before);
    expect(after.replica.status().unsent).toBe(1);
    await after.replica.sync();
    expect(after.replica.status().unsent).toBe(0);

    // and a refusal it hears later still ends the sign-in
    cell.signOut();
    await after.replica.sync();
    await expect
      .poll(() => runtime.session.get())
      .toStrictEqual({ kind: "signed-out", notice: SIGNED_OUT_ELSEWHERE });
    expect(keys.held()).toBeNull();
  });

  it("is signed out of a sign-in the cloud ended though its copy would not go, and wipes it at the next launch", async () => {
    const cell = createFakeCell();
    await noteOnTheMac(cell, "Plans");
    const keys = keychain(KEPT);
    const sql = openNodeReplicaSql(":memory:");
    const db = refusingOnce(sql);
    const first = runtimeOver(cell, { keys, sql: db.port });
    await first.runtime.start();
    await signedIn(first.runtime).replica.sync();

    cell.signOut();
    db.refuseNext();
    await signedIn(first.runtime).replica.sync();
    await expect
      .poll(() => first.runtime.session.get())
      .toStrictEqual({
        kind: "signed-out",
        notice: `${SIGNED_OUT_ELSEWHERE} It couldn't remove its copy yet, and tries again the next time Inteligir opens: database or disk is full`,
      });
    expect(keys.held()).toStrictEqual(KEPT);

    const again = runtimeOver(cell, { keys, sql });
    await again.runtime.start();
    await signedIn(again.runtime).replica.sync();
    await expect
      .poll(() => again.runtime.session.get())
      .toStrictEqual({ kind: "signed-out", notice: SIGNED_OUT_ELSEWHERE });
    expect(keys.held()).toBeNull();
    await expect(sql.all("SELECT id FROM items", [])).resolves.toStrictEqual([]);
  });
});
