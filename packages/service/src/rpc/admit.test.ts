import { CLIENT_BUILD_HEADER } from "@repo/contract/client-build";
import { PHONE_ORIGIN } from "@repo/contract/origin";
import { rateLimit } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import { dbSuite } from "@repo/db/test-database";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";

import { holderRateKey, RATE_WINDOWS } from "../rate-limit";
import {
  sessionOf,
  sessionTokenOf,
  signInPhone,
  signUpUser,
} from "../test-support/auth-requests.test-utils";
import {
  buildHeaders,
  extensionHeaders,
  FLOOR_VERSION,
  pageHeaders,
  phoneHeaders,
  v1Link,
  v1Post,
} from "../test-support/v1-link.test-utils";

const OUTDATED = { code: "CLIENT_OUTDATED", defined: true, status: 426 };
const SIGNED_OUT = { code: "UNAUTHORIZED", defined: true, status: 401 };
const TOO_MANY = { code: "TOO_MANY_REQUESTS", defined: true, status: 429 };

const versionAround = (majorStep: number, minorStep: number) => {
  const [major = "0", minor = "0"] = FLOOR_VERSION.split(".");

  return `${String(Number(major) + majorStep)}.${String(Number(minor) + minorStep)}.99`;
};

const asBuild = (phone: string, build: string | null) => {
  const headers = { cookie: phone, "expo-origin": PHONE_ORIGIN };

  return (build === null ? headers : { ...headers, [CLIENT_BUILD_HEADER]: build }) satisfies Record<
    string,
    string
  >;
};

const signedIn = async (email: string) => {
  const { cookie } = await signUpUser(email);

  return { cookie, phone: await signInPhone(email) } satisfies { cookie: string; phone: string };
};

const refusalOfList = async (headers: Record<string, string>) => {
  const link = v1Link(headers);

  return await link.refusalOf(link.account.devices.list());
};

dbSuite("the build floor", () => {
  it("refuses a call that names no build, or one it cannot read", async () => {
    const { phone } = await signedIn("floor-missing@example.test");

    for (const build of [null, "", FLOOR_VERSION, "latest+desktop"]) {
      await expect(refusalOfList(asBuild(phone, build)), String(build)).resolves.toStrictEqual(
        OUTDATED,
      );
    }
  });

  it("refuses a build below the floor, and its prerelease, before it judges the session", async () => {
    const { phone } = await signedIn("floor-below@example.test");
    const below = `${versionAround(0, -1)}+desktop`;

    for (const build of [below, `${FLOOR_VERSION}-beta.1+mobile`]) {
      await expect(refusalOfList(asBuild(phone, build)), build).resolves.toStrictEqual(OUTDATED);
    }

    await expect(refusalOfList({ [CLIENT_BUILD_HEADER]: below })).resolves.toStrictEqual(OUTDATED);
    await expect(sessionOf({ cookie: phone })).resolves.not.toBeNull();
  });

  it("answers a build at or above the floor, whatever platform it names", async () => {
    const { phone } = await signedIn("floor-at@example.test");

    for (const headers of [phoneHeaders(phone), asBuild(phone, `${versionAround(1, 0)}+android`)]) {
      const { devices } = await v1Link(headers).account.devices.list();
      expect(devices.map((row) => row.name)).toStrictEqual(["Chrome on Mac", "iPhone"]);
    }
  });

  it("answers the site's own pages, which ship in the same deployment and name no build", async () => {
    const { cookie } = await signedIn("floor-page@example.test");
    const { devices } = await v1Link(pageHeaders(cookie)).account.devices.list();
    expect(devices.filter((device) => device.current)).toHaveLength(1);
    await expect(
      refusalOfList({ ...pageHeaders(cookie), "sec-fetch-site": "cross-site" }),
    ).resolves.toStrictEqual(OUTDATED);
    await expect(
      refusalOfList({ ...pageHeaders(cookie), authorization: "Bearer any" }),
    ).resolves.toStrictEqual(OUTDATED);
  });
});

dbSuite("the door a session comes through", () => {
  it("refuses a call with no session before it reads its path or body", async () => {
    for (const row of ["account/devices/revoke", "account/no-such-row", "library/items/read"]) {
      const answer = await v1Post(row, buildHeaders(), JSON.stringify({ json: { id: 7 } }));
      expect(answer.status, row).toBe(401);
      await expect(answer.json(), row).resolves.toMatchObject({
        json: { code: "UNAUTHORIZED", defined: true },
      });
    }
  });

  it("reads the phone's cookie under its app scheme alone", async () => {
    const { phone } = await signedIn("door-phone@example.test");
    await expect(v1Link(phoneHeaders(phone)).account.devices.list()).resolves.toMatchObject({
      devices: [{ name: "Chrome on Mac" }, { name: "iPhone" }],
    });

    for (const headers of [
      { ...buildHeaders(), cookie: phone },
      { ...buildHeaders(), cookie: phone, "expo-origin": "exp://192.168.1.2:8081" },
      { ...buildHeaders(), cookie: phone, "sec-fetch-site": "cross-site" },
    ]) {
      await expect(refusalOfList(headers)).resolves.toStrictEqual(SIGNED_OUT);
    }
  });

  it("reads the site's own tab on its cookie, and no other page riding it", async () => {
    const { cookie } = await signedIn("door-page@example.test");
    await expect(v1Link(pageHeaders(cookie)).account.devices.list()).resolves.toMatchObject({
      devices: [{ current: true }, { current: false }],
    });
    await expect(
      refusalOfList({ ...buildHeaders(), cookie, "sec-fetch-site": "cross-site" }),
    ).resolves.toStrictEqual(SIGNED_OUT);
  });
});

dbSuite("the extension's bearer", () => {
  it("reads the browser's own signed session cookie", async () => {
    const { cookie } = await signedIn("door-extension@example.test");
    const { devices } = await v1Link(extensionHeaders(cookie)).account.devices.list();
    expect(devices.find((device) => device.current)?.name).toBe("Chrome on Mac");
  });

  it("refuses a bearer no session signed, and never reads the cookie beside it", async () => {
    const { cookie } = await signedIn("door-bad-bearer@example.test");
    const [token = "", signature = ""] = decodeURIComponent(sessionTokenOf(cookie)).split(".");

    for (const bearer of [
      "not-a-session",
      token,
      `${token}.${signature.split("").toReversed().join("")}`,
    ]) {
      await expect(
        refusalOfList({ ...phoneHeaders(cookie), authorization: `Bearer ${bearer}` }),
        bearer,
      ).resolves.toStrictEqual(SIGNED_OUT);
    }
  });
});

dbSuite("the session's minute", () => {
  it("answers a session's calls up to the minute's max and refuses the next, its session live and its account's others answered", async () => {
    const { cookie, phone } = await signedIn("minute-spent@example.test");
    const phoneSession = await sessionOf({ cookie: phone });

    if (phoneSession === null) {
      throw new Error("the phone signed in with no session");
    }

    await db.insert(rateLimit).values({
      count: RATE_WINDOWS.rpcCall.max - 1,
      id: crypto.randomUUID(),
      key: holderRateKey("rpcCall", phoneSession.session.id),
      lastRequest: Date.now(),
    });

    await expect(v1Link(phoneHeaders(phone)).account.devices.list()).resolves.toMatchObject({
      devices: [{ current: false }, { current: true }],
    });
    await expect(refusalOfList(phoneHeaders(phone))).resolves.toStrictEqual(TOO_MANY);

    await expect(sessionOf({ cookie: phone })).resolves.not.toBeNull();
    await expect(v1Link(pageHeaders(cookie)).account.devices.list()).resolves.toMatchObject({
      devices: [{ current: true }, { current: false }],
    });
  });

  it("is spent only by a signed call, so a refused one leaves it whole", async () => {
    const { phone } = await signedIn("minute-unsigned@example.test");
    const phoneSession = await sessionOf({ cookie: phone });

    if (phoneSession === null) {
      throw new Error("the phone signed in with no session");
    }

    await refusalOfList(asBuild(phone, null));
    await refusalOfList({ ...buildHeaders(), cookie: phone });

    const minute = holderRateKey("rpcCall", phoneSession.session.id);
    await expect(
      db.select().from(rateLimit).where(eq(rateLimit.key, minute)),
    ).resolves.toStrictEqual([]);
  });
});
