// `/v1/rpc` end to end, as an app's link calls it: the Worker's floor and credential, the principal
// it stamps on what it forwards, one account's cell out of another's reach, and the status every
// refusal answers under.

import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { V1Client } from "@repo/contract/cloud/v1";
import { V1_RPC_PATH } from "@repo/contract/cloud/v1";
import { env, exports } from "cloudflare:workers";
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
  ORIGIN,
  PASSWORD,
  sessionHeaders,
  signUpUser,
  userIdOf,
} from "../test-support/cloud-helpers";
import { cellOf, clockAt, engineIn, inCell } from "../test-support/library-cell";

// a link as an app holds one, its headers fixed, and the status each answer came under
const linkWith = (headers: Record<string, string>) => {
  const statuses: number[] = [];
  const client = createORPCClient<V1Client>(
    new RPCLink({
      fetch: async (url, init) => {
        const response = await exports.default.fetch(url, init);
        statuses.push(response.status);
        return response;
      },
      headers,
      origin: ORIGIN,
      url: V1_RPC_PATH,
    }),
  );
  // the refusal a call met, with the status it was answered under
  const refusalOf = async (call: Promise<unknown>) => {
    try {
      await call;
    } catch (error) {
      if (error instanceof ORPCError) {
        return {
          code: error.code,
          data: error.data,
          defined: error.defined,
          status: statuses.at(-1),
        };
      }
      throw error;
    }
    throw new Error("the call landed what the test expected it to refuse");
  };
  // the client is a proxy, so its two routers are read off it rather than spread
  return { account: client.account, library: client.library, refusalOf, statuses };
};

// an account signed in on a laptop: its credential's link, its session cookie and its id
const signedUp = async (email: string) => {
  const { cookie } = await signUpUser(email);
  const laptop = await loginDevice(cookie, "Laptop");
  const accountId = await userIdOf(cookie);
  return {
    accountId,
    cookie,
    credential: laptop.credential,
    laptop: linkWith(deviceHeaders(laptop.credential)),
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
    const stale = linkWith({ authorization: `Bearer ${credential}` });
    // each call made in its turn, so no refusal waits unheard behind another
    for (const call of [() => stale.library.items.list({}), () => stale.account.devices.list()]) {
      expect(await stale.refusalOf(call())).toMatchObject({
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
    const forged = linkWith({
      ...sessionHeaders(cookie),
      authorization: "Bearer igd_not-a-device",
    });
    // each call made in its turn, so no refusal waits unheard behind another
    for (const call of [() => forged.library.items.list({}), () => forged.account.devices.list()]) {
      expect(await forged.refusalOf(call())).toMatchObject({
        code: "UNAUTHORIZED",
        defined: true,
        status: 401,
      });
    }
  });

  it("reaches the library from the site's own tab on its session, and from no other page", async () => {
    const { cookie } = await signedUp("rpc-cookie@example.test");
    const tab = linkWith(sessionHeaders(cookie));
    const { item } = await tab.library.items.createNote({ markdown: "From the tab." });
    const history = await tab.library.history.list({ itemId: item.id });
    expect(history.changeSets[0]?.label).toBe("You in the browser");

    // another site's page riding the same cookie: a build header gets it past the floor, and the
    // cookie still counts for nothing
    const elsewhere = linkWith({ ...buildHeaders(), cookie, "sec-fetch-site": "cross-site" });
    expect(await elsewhere.refusalOf(elsewhere.library.items.list({}))).toMatchObject({
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
    const stamped = linkWith({ ...deviceHeaders(mine.credential), [PRINCIPAL_HEADER]: claim });
    const { item } = await stamped.library.items.createNote({ markdown: "Whose is this?" });

    const listed = await mine.laptop.library.items.list({});
    expect(listed.items.map((summary) => summary.id)).toEqual([item.id]);
    const history = await mine.laptop.library.history.list({ itemId: item.id });
    expect(history.changeSets[0]?.label).toBe("You on Laptop");
    const elsewhere = await theirs.laptop.library.items.list({});
    expect(elsewhere.items).toEqual([]);

    // the claim alone, with no credential, reaches nobody's cell
    const bare = linkWith({ ...buildHeaders(), [PRINCIPAL_HEADER]: claim });
    expect(await bare.refusalOf(bare.library.items.list({}))).toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("keeps one account's items out of another's reach", async () => {
    const a = await signedUp("rpc-isolate-a@example.test");
    const b = await signedUp("rpc-isolate-b@example.test");
    const { item } = await a.laptop.library.items.createNote({ markdown: "Only mine." });
    expect(await b.laptop.refusalOf(b.laptop.library.items.read({ id: item.id }))).toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(await b.laptop.library.search({ query: "mine" })).toEqual({ cursor: null, hits: [] });
    expect(await b.laptop.library.items.delete({ ids: [item.id] })).toEqual({
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
      [() => laptop.library.items.read({ id: crypto.randomUUID() }), "NOT_FOUND", 404],
      [
        () =>
          laptop.library.items.edit({
            baseSeq: seq,
            edits: [{ newText: "Uno.", oldText: "One." }],
            id: item.id,
          }),
        "CONFLICT",
        409,
      ],
      [
        () =>
          laptop.library.items.edit({
            baseSeq: now,
            edits: [{ newText: "x", oldText: "Not in the item." }],
            id: item.id,
          }),
        "UNPROCESSABLE_CONTENT",
        422,
      ],
      [
        () =>
          laptop.library.items.createFile({
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
      [() => laptop.library.history.undo({ changeSetIds: setIds }), "ALREADY_UNDONE", 409],
      [() => laptop.library.agent.send({ text: "Tidy my library." }), "SERVICE_UNAVAILABLE", 503],
      [() => laptop.library.search({ query: " " }), "BAD_REQUEST", 400],
    ] as const;
    for (const [call, code, status] of refusals) {
      expect(await laptop.refusalOf(call()), code).toMatchObject({ code, status });
    }
  });

  it("answers the account's refusals under the statuses the wire declares", async () => {
    const email = "rpc-account-statuses@example.test";
    const { laptop } = await signedUp(email);
    const anonymous = linkWith(buildHeaders());
    const wrong = "not-the-password-0000";
    const invite = await freshInvite();
    const unsigned = [
      [
        () => anonymous.account.signIn({ deviceName: "Phone", email, password: wrong }),
        "INVALID_CREDENTIALS",
        401,
      ],
      [
        () =>
          anonymous.account.signUp({
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
        () =>
          anonymous.account.signUp({
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
      expect(await anonymous.refusalOf(call()), code).toMatchObject({ code, status });
    }
    const signed = [
      [() => laptop.account.delete({ password: wrong }), "INVALID_CREDENTIALS", 401],
      [() => laptop.account.devices.revoke({ deviceId: "not-a-device" }), "NOT_FOUND", 404],
      [() => laptop.account.assistants.revoke({ grantId: "grant" }), "NOT_FOUND", 404],
    ] as const;
    for (const [call, code, status] of signed) {
      expect(await laptop.refusalOf(call()), code).toMatchObject({ code, status });
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
    const anonymous = linkWith(buildHeaders());
    expect(
      await anonymous.refusalOf(
        anonymous.account.signIn({ deviceName: "One Too Many", email, password: PASSWORD }),
      ),
    ).toMatchObject({ code: "DEVICE_LIMIT", defined: true, status: 409 });
  });

  it("answers a library whose account was deleted meanwhile as gone", async () => {
    const { accountId, laptop } = await signedUp("rpc-gone@example.test");
    await inCell(cellOf(accountId), (state) => {
      engineIn(state, clockAt()).tombstone();
    });
    expect(
      await laptop.refusalOf(laptop.library.items.createNote({ markdown: "Late." })),
    ).toMatchObject({
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
        () => laptop.library.items.list({}),
        () => laptop.account.devices.list(),
      ]) {
        expect(await laptop.refusalOf(call())).toMatchObject({
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
    const anonymous = linkWith(buildHeaders());
    const phone = await anonymous.account.signIn({
      deviceName: "Phone",
      email,
      password: PASSWORD,
    });
    const onPhone = linkWith(deviceHeaders(phone.credential));
    const { devices } = await onPhone.account.devices.list();
    expect(devices.map((row) => row.name).toSorted()).toEqual(["Laptop", "Phone"]);
    const ticket = await onPhone.account.socketTicket();
    expect(ticket.ticket).not.toBe("");
    expect(await laptop.account.assistants.list()).toEqual({ assistants: [] });

    expect(await onPhone.account.signOut()).toEqual({ revoked: true });
    expect(await onPhone.refusalOf(onPhone.library.items.list({}))).toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("signs up with an invite, answering the new device's credential", async () => {
    const anonymous = linkWith(buildHeaders());
    const signedIn = await anonymous.account.signUp({
      deviceName: "Laptop",
      email: "rpc-sign-up@example.test",
      inviteCode: await freshInvite(),
      name: "New Person",
      password: PASSWORD,
    });
    const fresh = linkWith(deviceHeaders(signedIn.credential));
    expect(await fresh.library.items.list({})).toEqual({ cursor: null, items: [] });
  });

  it("ends a browser tab's own session when it signs out", async () => {
    const { cookie } = await signedUp("rpc-tab-sign-out@example.test");
    const tab = linkWith(sessionHeaders(cookie));
    expect(await tab.account.signOut()).toEqual({ revoked: true });
    expect(await tab.refusalOf(tab.library.items.list({}))).toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("deletes the account with its password asked again, and everything it held goes", async () => {
    const email = "rpc-delete@example.test";
    const { accountId, credential, laptop } = await signedUp(email);
    await laptop.library.items.createNote({ markdown: "Soon gone." });
    await env.BLOBS.put(blobKey(accountId, "c".repeat(64)), "bytes");

    expect(await laptop.account.delete({ password: PASSWORD })).toEqual({ deleted: true });

    const db = createDb(env.DB);
    expect(await db.select().from(user).where(eq(user.id, accountId)).all()).toEqual([]);
    expect(await db.select().from(device).where(eq(device.userId, accountId)).all()).toEqual([]);
    expect(await db.select().from(session).where(eq(session.userId, accountId)).all()).toEqual([]);
    const files = await env.BLOBS.list({ prefix: accountBlobPrefix(accountId) });
    expect(files.objects).toEqual([]);
    await inCell(cellOf(accountId), (state) => {
      const library = engineIn(state, clockAt());
      expect(library.deletedAt()).not.toBeNull();
      expect(library.head()).toBe(0);
    });
    const after = linkWith(deviceHeaders(credential));
    expect(await after.refusalOf(after.library.items.list({}))).toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });
});
