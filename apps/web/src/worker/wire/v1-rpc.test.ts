// `/v1/rpc` end to end, as an app's link calls it: the Worker's floor and credential, the principal
// it stamps on what it forwards, one account's cell out of another's reach, and the status every
// refusal answers under.

import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../db/client";
import { device, inviteCode, rateLimit, session, user } from "../db/schema";
import { accountBlobPrefix, blobKey } from "../library/cell-blobs";
import { PRINCIPAL_HEADER, principalHeaderValue } from "../library/library-principal";
import { deviceRateKey } from "../rate-limit";
import {
  buildHeaders,
  deviceHeaders,
  loginDevice,
  PASSWORD,
  sessionHeaders,
  signUpUser,
  userIdOf,
  v1Link,
} from "../test-support/cloud-helpers";
import { cellOf, clockAt, engineIn, inCell } from "../test-support/library-cell";

// an account signed in on a laptop: its credential's link, its session cookie and its id
const signedUp = async (email: string) => {
  const { cookie } = await signUpUser(email);
  const laptop = await loginDevice(cookie, "Laptop");
  const accountId = await userIdOf(cookie);
  return {
    accountId,
    cookie,
    credential: laptop.credential,
    laptop: v1Link(deviceHeaders(laptop.credential)),
  };
};

const freshInvite = async (): Promise<string> => {
  const code = `RPC-TEST-${crypto.randomUUID()}`;
  await createDb(env.DB).insert(inviteCode).values({ code });
  return code;
};

describe("the one wire's door", () => {
  it("refuses a build below the floor before it reads anything else", async () => {
    const { credential } = await signedUp("rpc-floor@example.test");
    const stale = v1Link({ authorization: `Bearer ${credential}` });
    // each call made in its turn, so no refusal waits unheard behind another
    for (const call of [
      async () => await stale.library.items.list({}),
      async () => await stale.account.devices.list(),
    ]) {
      await expect(stale.refusalOf(call())).resolves.toMatchObject({
        code: "CLIENT_OUTDATED",
        defined: true,
        status: 426,
      });
    }
  });

  it("reaches the account's own library on a device's bearer", async () => {
    const { laptop } = await signedUp("rpc-bearer@example.test");
    const { item } = await laptop.library.items.createNote({ markdown: "From the laptop." });
    const read = await laptop.library.items.read({ id: item.id });
    expect(read.view.markdown).toBe("From the laptop.\n");
    const history = await laptop.library.history.list({ itemId: item.id });
    expect(history.changeSets[0]?.label).toBe("You on Laptop");
  });

  it("refuses a bearer that does not verify, and never reads the cookie beside it", async () => {
    const { cookie } = await signedUp("rpc-bad-bearer@example.test");
    const forged = v1Link({
      ...sessionHeaders(cookie),
      authorization: "Bearer igd_not-a-device",
    });
    // each call made in its turn, so no refusal waits unheard behind another
    for (const call of [
      async () => await forged.library.items.list({}),
      async () => await forged.account.devices.list(),
    ]) {
      await expect(forged.refusalOf(call())).resolves.toMatchObject({
        code: "UNAUTHORIZED",
        defined: true,
        status: 401,
      });
    }
  });

  it("reaches the library from the site's own tab on its session, and from no other page", async () => {
    const { cookie } = await signedUp("rpc-cookie@example.test");
    const tab = v1Link(sessionHeaders(cookie));
    const { item } = await tab.library.items.createNote({ markdown: "From the tab." });
    const history = await tab.library.history.list({ itemId: item.id });
    expect(history.changeSets[0]?.label).toBe("You in the browser");

    // another site's page riding the same cookie: a build header gets it past the floor, and the
    // cookie still counts for nothing
    const elsewhere = v1Link({ ...buildHeaders(), cookie, "sec-fetch-site": "cross-site" });
    await expect(elsewhere.refusalOf(elsewhere.library.items.list({}))).resolves.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("forwards the principal its credential verified and drops the one a request brought", async () => {
    const mine = await signedUp("rpc-stamp-a@example.test");
    const theirs = await signedUp("rpc-stamp-b@example.test");
    const claim = principalHeaderValue({
      accountId: theirs.accountId,
      actor: { deviceId: "stolen", deviceName: "Stolen", kind: "device" },
      scopes: ["library"],
    });
    const stamped = v1Link({ ...deviceHeaders(mine.credential), [PRINCIPAL_HEADER]: claim });
    const { item } = await stamped.library.items.createNote({ markdown: "Whose is this?" });

    const listed = await mine.laptop.library.items.list({});
    expect(listed.items.map((summary) => summary.id)).toStrictEqual([item.id]);
    const history = await mine.laptop.library.history.list({ itemId: item.id });
    expect(history.changeSets[0]?.label).toBe("You on Laptop");
    const elsewhere = await theirs.laptop.library.items.list({});
    expect(elsewhere.items).toStrictEqual([]);

    // the claim alone, with no credential, reaches nobody's cell
    const bare = v1Link({ ...buildHeaders(), [PRINCIPAL_HEADER]: claim });
    await expect(bare.refusalOf(bare.library.items.list({}))).resolves.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("keeps one account's items out of another's reach", async () => {
    const a = await signedUp("rpc-isolate-a@example.test");
    const b = await signedUp("rpc-isolate-b@example.test");
    const { item } = await a.laptop.library.items.createNote({ markdown: "Only mine." });
    await expect(
      b.laptop.refusalOf(b.laptop.library.items.read({ id: item.id })),
    ).resolves.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    await expect(b.laptop.library.search({ query: "mine" })).resolves.toStrictEqual({
      cursor: null,
      hits: [],
    });
    await expect(b.laptop.library.items.delete({ ids: [item.id] })).resolves.toStrictEqual({
      deleted: [],
      missing: [item.id],
    });
  });
});

describe("every refusal's status", () => {
  it("answers the library's refusals under the statuses the wire declares", async () => {
    const { laptop } = await signedUp("rpc-statuses@example.test");
    const { item } = await laptop.library.items.createNote({ markdown: "One.\n\nTwo." });
    const { seq } = await laptop.library.items.read({ id: item.id });
    await laptop.library.items.edit({
      baseSeq: seq,
      edits: [{ newText: "Two, edited.", oldText: "Two." }],
      id: item.id,
    });
    const { changeSets } = await laptop.library.history.list({ itemId: item.id });
    const setIds = changeSets.map((set) => set.id);
    await laptop.library.history.undo({ changeSetIds: setIds });
    const { seq: now } = await laptop.library.items.read({ id: item.id });

    // each call made only when its turn comes, so every status is its own call's
    const refusals = [
      [async () => await laptop.library.items.read({ id: crypto.randomUUID() }), "NOT_FOUND", 404],
      [
        async () =>
          await laptop.library.items.edit({
            baseSeq: seq,
            edits: [{ newText: "Uno.", oldText: "One." }],
            id: item.id,
          }),
        "CONFLICT",
        409,
      ],
      [
        async () =>
          await laptop.library.items.edit({
            baseSeq: now,
            edits: [{ newText: "x", oldText: "Not in the item." }],
            id: item.id,
          }),
        "UNPROCESSABLE_CONTENT",
        422,
      ],
      [
        async () =>
          await laptop.library.items.createFile({
            folderId: null,
            id: "01a0f4c2-c400-78d9-a955-7935ec13d6d5",
            name: "photo.png",
            savedAt: Date.UTC(2026, 9, 1),
            sha: "b".repeat(64),
            tags: [],
          }),
        "BLOB_MISSING",
        409,
      ],
      [
        async () => await laptop.library.history.undo({ changeSetIds: setIds }),
        "ALREADY_UNDONE",
        409,
      ],
      [
        async () => {
          // the person turned the built-in agent off
          await laptop.library.agent.setEnabled({ enabled: false });
          return await laptop.library.agent.send({ text: "Tidy my library." });
        },
        "SERVICE_UNAVAILABLE",
        503,
      ],
      [async () => await laptop.library.search({ query: " " }), "BAD_REQUEST", 400],
    ] as const;
    for (const [call, code, status] of refusals) {
      await expect(laptop.refusalOf(call()), code).resolves.toMatchObject({ code, status });
    }
  });

  it("answers the account's refusals under the statuses the wire declares", async () => {
    const email = "rpc-account-statuses@example.test";
    const { laptop } = await signedUp(email);
    const anonymous = v1Link(buildHeaders());
    const wrong = "not-the-password-0000";
    const invite = await freshInvite();
    const unsigned = [
      [
        async () => await anonymous.account.signIn({ deviceName: "Phone", email, password: wrong }),
        "INVALID_CREDENTIALS",
        401,
      ],
      [
        async () =>
          await anonymous.account.signUp({
            deviceName: "Phone",
            email: "rpc-nobody@example.test",
            inviteCode: "NOT-A-CODE",
            name: "Nobody",
            password: PASSWORD,
          }),
        "FORBIDDEN",
        403,
      ],
      [
        async () =>
          await anonymous.account.signUp({
            deviceName: "Phone",
            email,
            inviteCode: invite,
            name: "Again",
            password: PASSWORD,
          }),
        "ACCOUNT_EXISTS",
        409,
      ],
    ] as const;
    for (const [call, code, status] of unsigned) {
      await expect(anonymous.refusalOf(call()), code).resolves.toMatchObject({ code, status });
    }
    const signed = [
      [async () => await laptop.account.delete({ password: wrong }), "INVALID_CREDENTIALS", 401],
      [
        async () => await laptop.account.devices.revoke({ deviceId: "not-a-device" }),
        "NOT_FOUND",
        404,
      ],
      [async () => await laptop.account.assistants.revoke({ grantId: "grant" }), "NOT_FOUND", 404],
    ] as const;
    for (const [call, code, status] of signed) {
      await expect(laptop.refusalOf(call()), code).resolves.toMatchObject({ code, status });
    }
  });

  it("refuses a sign-in past the account's device cap as its row declares", async () => {
    const email = "rpc-device-cap@example.test";
    const { accountId } = await signedUp(email);
    const db = createDb(env.DB);
    // the laptop holds one of the twenty
    for (let index = 1; index < 20; index += 1) {
      await db.insert(device).values({
        createdAt: new Date(),
        credentialHash: `rpc-cap-hash-${String(index)}`,
        id: `rpc-cap-device-${String(index)}`,
        name: `Device ${String(index)}`,
        userId: accountId,
      });
    }
    const anonymous = v1Link(buildHeaders());
    await expect(
      anonymous.refusalOf(
        anonymous.account.signIn({ deviceName: "One Too Many", email, password: PASSWORD }),
      ),
    ).resolves.toMatchObject({ code: "DEVICE_LIMIT", defined: true, status: 409 });
  });

  it("answers a library whose account was deleted meanwhile as gone", async () => {
    const { accountId, laptop } = await signedUp("rpc-gone@example.test");
    await inCell(cellOf(accountId), (state) => {
      engineIn(state, clockAt()).tombstone();
    });
    await expect(
      laptop.refusalOf(laptop.library.items.createNote({ markdown: "Late." })),
    ).resolves.toMatchObject({
      code: "GONE",
      defined: true,
      status: 410,
    });
  });

  describe("with the limiter on", () => {
    let wasDisabled: Env["RATE_LIMIT_DISABLED"] = "true";
    beforeEach(() => {
      wasDisabled = env.RATE_LIMIT_DISABLED;
      env.RATE_LIMIT_DISABLED = "false";
    });
    afterEach(() => {
      env.RATE_LIMIT_DISABLED = wasDisabled;
    });

    it("refuses a device past its minute's calls, on the library and the account alike", async () => {
      const { accountId, laptop } = await signedUp("rpc-limited@example.test");
      const devices = await createDb(env.DB)
        .select({ deviceId: device.id })
        .from(device)
        .where(eq(device.userId, accountId))
        .all();
      const spent = devices.map(({ deviceId }) => ({
        count: 1200,
        id: crypto.randomUUID(),
        key: deviceRateKey("rpc", deviceId),
        lastRequest: Date.now(),
      }));
      await createDb(env.DB).insert(rateLimit).values(spent).onConflictDoNothing();
      expect(spent).toHaveLength(1);
      // each call made in its turn, so no refusal waits unheard behind another
      for (const call of [
        async () => await laptop.library.items.list({}),
        async () => await laptop.account.devices.list(),
      ]) {
        await expect(laptop.refusalOf(call())).resolves.toMatchObject({
          code: "TOO_MANY_REQUESTS",
          defined: true,
          status: 429,
        });
      }
    });
  });
});

describe("the account's rows", () => {
  it("signs a device in and out, and lists the account's devices", async () => {
    const email = "rpc-sign-in@example.test";
    const { laptop } = await signedUp(email);
    const anonymous = v1Link(buildHeaders());
    const phone = await anonymous.account.signIn({
      deviceName: "Phone",
      email,
      password: PASSWORD,
    });
    const onPhone = v1Link(deviceHeaders(phone.credential));
    const { devices } = await onPhone.account.devices.list();
    expect(devices.map((row) => row.name).toSorted()).toStrictEqual(["Laptop", "Phone"]);
    const ticket = await onPhone.account.socketTicket();
    expect(ticket.ticket).not.toBe("");
    await expect(laptop.account.assistants.list()).resolves.toStrictEqual({ assistants: [] });

    await expect(onPhone.account.signOut()).resolves.toStrictEqual({ revoked: true });
    await expect(onPhone.refusalOf(onPhone.library.items.list({}))).resolves.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("signs up with an invite, answering the new device's credential", async () => {
    const anonymous = v1Link(buildHeaders());
    const signedIn = await anonymous.account.signUp({
      deviceName: "Laptop",
      email: "rpc-sign-up@example.test",
      inviteCode: await freshInvite(),
      name: "New Person",
      password: PASSWORD,
    });
    const fresh = v1Link(deviceHeaders(signedIn.credential));
    await expect(fresh.library.items.list({})).resolves.toStrictEqual({ cursor: null, items: [] });
  });

  it("mints the browser extension its own credential for the site's session alone", async () => {
    const email = "rpc-extension@example.test";
    const { accountId, cookie, laptop } = await signedUp(email);
    const tab = v1Link(sessionHeaders(cookie));
    const extension = await tab.account.connectExtension({ deviceName: "Browser extension" });
    expect(extension).toMatchObject({ email, userId: accountId });
    const { devices } = await laptop.account.devices.list();
    expect(devices.map((row) => row.name).toSorted()).toStrictEqual([
      "Browser extension",
      "Laptop",
    ]);
    // the extension's credential reaches the library, and the tab's session stays
    const fromExtension = v1Link(deviceHeaders(extension.credential));
    await expect(fromExtension.library.items.list({})).resolves.toStrictEqual({
      cursor: null,
      items: [],
    });
    await expect(tab.library.items.list({})).resolves.toStrictEqual({ cursor: null, items: [] });
    // a device's credential mints none: one stolen would mint credentials outliving its revocation
    await expect(
      laptop.refusalOf(laptop.account.connectExtension({ deviceName: "Another" })),
    ).resolves.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
  });

  it("ends a browser tab's own session when it signs out", async () => {
    const { cookie } = await signedUp("rpc-tab-sign-out@example.test");
    const tab = v1Link(sessionHeaders(cookie));
    await expect(tab.account.signOut()).resolves.toStrictEqual({ revoked: true });
    await expect(tab.refusalOf(tab.library.items.list({}))).resolves.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("deletes the account with its password asked again, and everything it held goes", async () => {
    const email = "rpc-delete@example.test";
    const { accountId, credential, laptop } = await signedUp(email);
    await laptop.library.items.createNote({ markdown: "Soon gone." });
    await env.BLOBS.put(blobKey(accountId, "c".repeat(64)), "bytes");

    await expect(laptop.account.delete({ password: PASSWORD })).resolves.toStrictEqual({
      deleted: true,
    });

    const db = createDb(env.DB);
    await expect(db.select().from(user).where(eq(user.id, accountId)).all()).resolves.toStrictEqual(
      [],
    );
    await expect(
      db.select().from(device).where(eq(device.userId, accountId)).all(),
    ).resolves.toStrictEqual([]);
    await expect(
      db.select().from(session).where(eq(session.userId, accountId)).all(),
    ).resolves.toStrictEqual([]);
    const files = await env.BLOBS.list({ prefix: accountBlobPrefix(accountId) });
    expect(files.objects).toStrictEqual([]);
    await inCell(cellOf(accountId), (state) => {
      const library = engineIn(state, clockAt());
      expect(library.deletedAt()).not.toBeNull();
      expect(library.head()).toBe(0);
    });
    const after = v1Link(deviceHeaders(credential));
    await expect(after.refusalOf(after.library.items.list({}))).resolves.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });
});
