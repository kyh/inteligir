// `/v1/rpc` end to end, as an app's link calls it: the Worker's floor and session, the principal
// it stamps on what it forwards, one account's cell out of another's reach, and the status every
// refusal answers under.

import { EXTENSION_ORIGIN } from "@repo/contract/extension/extension-identity";
import { V1_BLOBS_PATH } from "@repo/contract/library/library-blobs";
import { PHONE_ORIGIN } from "@repo/contract/origin";
import { V1_RPC_PATH } from "@repo/contract/v1";
import { env, exports } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { markGrantRevoked } from "../connector/revoked-grants";
import { createDb } from "@repo/db/d1/client";
import { rateLimit, revokedGrant, session, user } from "@repo/db/d1/schema";
import { accountBlobPrefix, blobKey } from "../library/cell-blobs";
import { PRINCIPAL_HEADER, principalHeaderValue } from "../library/library-principal";
import { holderRateKey } from "../rate-limit";
import {
  buildHeaders,
  drained,
  ORIGIN,
  PASSWORD,
  phoneHeaders,
  sessionHeaders,
  sessionIdOf,
  signInPhone,
  signOutPhone,
  signUpUser,
  userIdOf,
  v1Link,
} from "../test-support/cloud-helpers";
import { cellOf, clockAt, engineIn, inCell } from "../test-support/library-cell";

const DAY_MS = 86_400_000;

// an account made on the site and signed in on a phone: the phone's link and cookie, the site's
// session cookie and the account's id
const signedUp = async (email: string) => {
  const { cookie } = await signUpUser(email);
  const phoneCookie = await signInPhone(email);
  return {
    accountId: await userIdOf(cookie),
    cookie,
    phone: v1Link(phoneHeaders(phoneCookie)),
    phoneCookie,
  };
};

describe("the one wire's door", () => {
  it("lets no page of another origin read an answer, the extension's and the phone's header included", async () => {
    for (const [path, origin] of [
      [`${V1_RPC_PATH}/account/devices/list`, EXTENSION_ORIGIN],
      [`${V1_RPC_PATH}/account/devices/list`, "https://elsewhere.example"],
      [`${V1_RPC_PATH}/account/devices/list`, "tauri://localhost"],
      [`${V1_BLOBS_PATH}/${"a".repeat(64)}`, EXTENSION_ORIGIN],
      ["/api/auth/get-session", EXTENSION_ORIGIN],
      ["/api/auth/get-session", "https://elsewhere.example"],
    ] as const) {
      const preflight = await drained(
        exports.default.fetch(`${ORIGIN}${path}`, {
          headers: {
            "access-control-request-headers": "content-type, expo-origin, x-inteligir-build",
            "access-control-request-method": "POST",
            origin,
          },
          method: "OPTIONS",
        }),
      );
      expect(preflight.headers.get("access-control-allow-origin"), `${origin} ${path}`).toBeNull();
      const read = await drained(
        exports.default.fetch(`${ORIGIN}${path}`, { headers: { ...buildHeaders(), origin } }),
      );
      expect(read.headers.get("access-control-allow-origin"), `${origin} ${path}`).toBeNull();
    }
  });

  it("refuses a build below the floor before it reads anything else", async () => {
    const { phoneCookie } = await signedUp("rpc-floor@example.test");
    const stale = v1Link({ cookie: phoneCookie, "expo-origin": PHONE_ORIGIN });
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

  it("reaches the account's own library on the phone's session", async () => {
    const { phone } = await signedUp("rpc-phone@example.test");
    const { item } = await phone.library.items.createNote({ markdown: "From the phone." });
    const read = await phone.library.items.read({ id: item.id });
    expect(read.view.markdown).toBe("From the phone.\n");
    const history = await phone.library.history.list({});
    expect(history.changeSets[0]?.label).toBe("You on your iPhone");
  });

  it("refuses a bearer that does not verify, and never reads the cookie beside it", async () => {
    const { cookie } = await signedUp("rpc-bad-bearer@example.test");
    const forged = v1Link({
      ...sessionHeaders(cookie),
      authorization: "Bearer not-a-session",
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
    const history = await tab.library.history.list({});
    expect(history.changeSets[0]).toMatchObject({
      items: [expect.objectContaining({ id: item.id })],
      label: "You in the browser",
    });

    // another site's page riding the same cookie: a build header gets it past the floor, and the
    // cookie still counts for nothing
    const elsewhere = v1Link({ ...buildHeaders(), cookie, "sec-fetch-site": "cross-site" });
    await expect(elsewhere.refusalOf(elsewhere.library.items.list({}))).resolves.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("slides a browser's session only on the read its cookie can follow", async () => {
    const { accountId, cookie } = await signedUp("session-slide@example.test");
    const db = createDb(env.DB);
    const expiresAt = async (): Promise<number | undefined> => {
      const row = await db
        .select({ expiresAt: session.expiresAt })
        .from(session)
        .where(eq(session.userId, accountId))
        .get();
      return row?.expiresAt.getTime();
    };
    // Better Auth's default: a session slides once a day of its seven has passed
    const due = new Date(Date.now() + 5 * DAY_MS);
    await db.update(session).set({ expiresAt: due }).where(eq(session.userId, accountId));

    await v1Link(sessionHeaders(cookie)).account.devices.list();
    await expect(expiresAt()).resolves.toBe(due.getTime());

    const read = await drained(
      exports.default.fetch(`${ORIGIN}/api/auth/get-session`, { headers: { cookie } }),
    );
    expect(read.headers.getSetCookie().join("\n")).toContain("session_token");
    await expect(expiresAt()).resolves.toBeGreaterThan(due.getTime());
  });

  it("forwards the principal its credential verified and drops the one a request brought", async () => {
    const mine = await signedUp("rpc-stamp-a@example.test");
    const theirs = await signedUp("rpc-stamp-b@example.test");
    const claim = principalHeaderValue({
      accountId: theirs.accountId,
      actor: { door: "page", kind: "session", sessionId: "stolen" },
    });
    const stamped = v1Link({ ...phoneHeaders(mine.phoneCookie), [PRINCIPAL_HEADER]: claim });
    const { item } = await stamped.library.items.createNote({ markdown: "Whose is this?" });

    const listed = await mine.phone.library.items.list({});
    expect(listed.items.map((summary) => summary.id)).toStrictEqual([item.id]);
    const history = await mine.phone.library.history.list({});
    expect(history.changeSets[0]?.label).toBe("You on your iPhone");
    const elsewhere = await theirs.phone.library.items.list({});
    expect(elsewhere.items).toStrictEqual([]);

    // the claim alone, with no session, reaches nobody's cell
    const bare = v1Link({ ...buildHeaders(), [PRINCIPAL_HEADER]: claim });
    await expect(bare.refusalOf(bare.library.items.list({}))).resolves.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("keeps one account's items out of another's reach", async () => {
    const a = await signedUp("rpc-isolate-a@example.test");
    const b = await signedUp("rpc-isolate-b@example.test");
    const { item } = await a.phone.library.items.createNote({ markdown: "Only mine." });
    await expect(
      b.phone.refusalOf(b.phone.library.items.read({ id: item.id })),
    ).resolves.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    await expect(b.phone.library.search({ query: "mine" })).resolves.toStrictEqual({
      cursor: null,
      hits: [],
    });
    await expect(b.phone.library.items.delete({ ids: [item.id] })).resolves.toStrictEqual({
      deleted: [],
      missing: [item.id],
    });
  });
});

describe("every refusal's status", () => {
  it("answers the library's refusals under the statuses the wire declares", async () => {
    const { phone } = await signedUp("rpc-statuses@example.test");
    const { item } = await phone.library.items.createNote({ markdown: "One.\n\nTwo." });
    await phone.library.items.edit({
      edits: [{ newText: "Two, edited.", oldText: "Two." }],
      id: item.id,
    });
    const undoAll = async () => {
      const { changeSets } = await phone.library.history.list({});
      return await phone.library.history.undo({ changeSetIds: changeSets.map((set) => set.id) });
    };

    // each call made only when its turn comes, so every status is its own call's
    const refusals = [
      [async () => await phone.library.items.read({ id: crypto.randomUUID() }), "NOT_FOUND", 404],
      [
        async () =>
          await phone.library.write({
            itemId: item.id,
            ops: [{ base: "Not its title", field: "title", op: "set", value: "Uno" }],
          }),
        "CONFLICT",
        409,
      ],
      [
        async () =>
          await phone.library.items.edit({
            edits: [{ newText: "x", oldText: "Not in the item." }],
            id: item.id,
          }),
        "UNPROCESSABLE_CONTENT",
        422,
      ],
      [
        async () =>
          await phone.library.items.createFile({
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
        async () => {
          await undoAll();
          return await undoAll();
        },
        "ALREADY_UNDONE",
        409,
      ],
      [
        async () => {
          // the person turned the built-in agent off
          await phone.library.agent.setEnabled({ enabled: false });
          return await phone.library.agent.send({ text: "Tidy my library." });
        },
        "SERVICE_UNAVAILABLE",
        503,
      ],
      [async () => await phone.library.search({ query: " " }), "BAD_REQUEST", 400],
    ] as const;
    for (const [call, code, status] of refusals) {
      await expect(phone.refusalOf(call()), code).resolves.toMatchObject({ code, status });
    }
  });

  it("answers the account's refusals under the statuses the wire declares", async () => {
    const { phone } = await signedUp("rpc-account-statuses@example.test");
    const refusals = [
      [
        async () => await phone.account.delete({ password: "not-the-password-0000" }),
        "INVALID_CREDENTIALS",
        401,
      ],
      [async () => await phone.account.devices.revoke({ id: "not-a-session" }), "NOT_FOUND", 404],
      [async () => await phone.account.assistants.revoke({ grantId: "grant" }), "NOT_FOUND", 404],
    ] as const;
    for (const [call, code, status] of refusals) {
      await expect(phone.refusalOf(call()), code).resolves.toMatchObject({ code, status });
    }
  });

  it("answers a library whose account was deleted meanwhile as gone", async () => {
    const { accountId, phone } = await signedUp("rpc-gone@example.test");
    await inCell(cellOf(accountId), (state) => {
      engineIn(state, clockAt()).tombstone();
    });
    await expect(
      phone.refusalOf(phone.library.items.createNote({ markdown: "Late." })),
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

    it("refuses a session past its minute's calls, on the library and the account alike", async () => {
      const { phone, phoneCookie } = await signedUp("rpc-limited@example.test");
      await createDb(env.DB)
        .insert(rateLimit)
        .values({
          count: 1200,
          id: crypto.randomUUID(),
          key: holderRateKey("rpc", await sessionIdOf(phoneCookie)),
          lastRequest: Date.now(),
        });
      // each call made in its turn, so no refusal waits unheard behind another
      for (const call of [
        async () => await phone.library.items.list({}),
        async () => await phone.account.devices.list(),
      ]) {
        await expect(phone.refusalOf(call())).resolves.toMatchObject({
          code: "TOO_MANY_REQUESTS",
          defined: true,
          status: 429,
        });
      }
    });
  });
});

describe("the account's rows", () => {
  it("lists the account's devices, mints a socket's ticket, and refuses a session signed out", async () => {
    const { cookie, phone, phoneCookie } = await signedUp("rpc-rows@example.test");
    const { devices } = await phone.account.devices.list();
    expect(devices.map((row) => row.name)).toStrictEqual(["Chrome on Mac", "iPhone"]);
    const ticket = await phone.account.socketTicket();
    expect(ticket.ticket).not.toBe("");
    await expect(phone.account.assistants.list()).resolves.toStrictEqual({ assistants: [] });

    await signOutPhone(phoneCookie);
    await expect(phone.refusalOf(phone.library.items.list({}))).resolves.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
    await expect(v1Link(sessionHeaders(cookie)).library.items.list({})).resolves.toStrictEqual({
      cursor: null,
      items: [],
    });
  });

  it("ends a browser tab's own session, its cookie and its cached files when it signs out", async () => {
    const { cookie, phone } = await signedUp("rpc-tab-sign-out@example.test");
    const signedOut = await drained(
      exports.default.fetch(`${ORIGIN}/api/auth/sign-out`, {
        body: "{}",
        headers: { ...sessionHeaders(cookie), "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(signedOut.status).toBe(200);
    expect(signedOut.headers.getSetCookie().join("\n")).toMatch(/session_token=;/u);
    expect(signedOut.headers.get("clear-site-data")).toBe('"cache"');
    const tab = v1Link(sessionHeaders(cookie));
    await expect(tab.refusalOf(tab.library.items.list({}))).resolves.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
    await expect(phone.library.items.list({})).resolves.toStrictEqual({ cursor: null, items: [] });
  });

  it("deletes the account with its password asked again, and everything it held goes", async () => {
    const email = "rpc-delete@example.test";
    const { accountId, phone, phoneCookie } = await signedUp(email);
    await phone.library.items.createNote({ markdown: "Soon gone." });
    await env.BLOBS.put(blobKey(accountId, "c".repeat(64)), "bytes");
    const db = createDb(env.DB);
    await markGrantRevoked(db, { accountId, grantId: "disconnected" });

    await expect(phone.account.delete({ password: PASSWORD })).resolves.toStrictEqual({
      deleted: true,
    });

    await expect(db.select().from(user).where(eq(user.id, accountId)).all()).resolves.toStrictEqual(
      [],
    );
    await expect(
      db.select().from(revokedGrant).where(eq(revokedGrant.userId, accountId)).all(),
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
    const after = v1Link(phoneHeaders(phoneCookie));
    await expect(after.refusalOf(after.library.items.list({}))).resolves.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });
});
