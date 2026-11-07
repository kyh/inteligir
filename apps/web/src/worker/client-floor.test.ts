// The client build floor as every `/v1` caller meets it: a request that names no build, or one
// below `MIN_CLIENT_BUILD`, is refused before anything reads it, its credential left live; a page
// this Worker served, which ships in the same deploy, names none.

import { CLIENT_BUILD_HEADER } from "@repo/contract/cloud/client-build";
import { V1_BLOBS_PATH, V1_EXPORTS_PATH } from "@repo/contract/cloud/library/library-blobs";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  deviceHeaders,
  drained,
  loginDevice,
  ORIGIN,
  sessionHeaders,
  signUpUser,
  v1Link,
} from "./test-support/cloud-helpers";

// one minor under the floor vitest.config.ts sets, whatever the patch, and one major over it
const versionAround = (majorStep: number, minorStep: number): string => {
  const [major = "0", minor = "0"] = env.MIN_CLIENT_BUILD.split(".");
  return `${String(Number(major) + majorStep)}.${String(Number(minor) + minorStep)}.99`;
};
const below = (): string => versionAround(0, -1);

const signedIn = async (email: string): Promise<{ cookie: string; credential: string }> => {
  const { cookie } = await signUpUser(email);
  const { credential } = await loginDevice(cookie, "Laptop");
  return { cookie, credential };
};

const asBuild = (credential: string, build: string | null): Record<string, string> =>
  build === null
    ? { authorization: `Bearer ${credential}` }
    : { authorization: `Bearer ${credential}`, [CLIENT_BUILD_HEADER]: build };

const OUTDATED = { code: "CLIENT_OUTDATED", defined: true, status: 426 };

const refusalOfList = async (headers: Record<string, string>) => {
  const link = v1Link(headers);
  return await link.refusalOf(link.account.devices.list());
};

describe("the client build floor", () => {
  it("refuses a call that names no build, or one it cannot read", async () => {
    const { credential } = await signedIn("floor-missing@example.test");
    for (const build of [null, "", "0.7.0", "latest+desktop"]) {
      await expect(refusalOfList(asBuild(credential, build)), String(build)).resolves.toMatchObject(
        OUTDATED,
      );
    }
  });

  it("refuses a build below the floor, and its prerelease, before it judges the credential", async () => {
    const { credential } = await signedIn("floor-below@example.test");
    for (const build of [`${below()}+desktop`, `${env.MIN_CLIENT_BUILD}-beta.1+mobile`]) {
      await expect(refusalOfList(asBuild(credential, build)), build).resolves.toMatchObject(
        OUTDATED,
      );
    }
    await expect(
      refusalOfList({ [CLIENT_BUILD_HEADER]: `${below()}+desktop` }),
    ).resolves.toMatchObject(OUTDATED);
  });

  it("answers a build at or above the floor, whatever platform it names", async () => {
    const { credential } = await signedIn("floor-at@example.test");
    for (const headers of [
      deviceHeaders(credential),
      asBuild(credential, `${versionAround(1, 0)}+android`),
    ]) {
      const { devices } = await v1Link(headers).account.devices.list();
      expect(devices.map((row) => row.name)).toStrictEqual(["Laptop"]);
    }
  });

  it("refuses the sign-in before it checks the password", async () => {
    const stale = v1Link({});
    await expect(
      stale.refusalOf(
        stale.account.signIn({
          deviceName: "Laptop",
          email: "nobody@example.test",
          password: "not-the-password",
        }),
      ),
    ).resolves.toMatchObject(OUTDATED);
  });

  it("refuses a file and an export as it refuses a call", async () => {
    const { credential } = await signedIn("floor-bytes@example.test");
    for (const path of [
      `${V1_BLOBS_PATH}/${"a".repeat(64)}`,
      `${V1_EXPORTS_PATH}/${crypto.randomUUID()}`,
    ]) {
      const response = await drained(
        exports.default.fetch(`${ORIGIN}${path}`, { headers: asBuild(credential, null) }),
      );
      expect(response.status, path).toBe(426);
    }
  });

  it("answers this Worker's own pages, which ship in the same deploy", async () => {
    const { cookie } = await signedIn("floor-page@example.test");
    const { devices } = await v1Link(sessionHeaders(cookie)).account.devices.list();
    expect(devices).toHaveLength(1);
    await expect(
      refusalOfList({ ...sessionHeaders(cookie), "sec-fetch-site": "cross-site" }),
    ).resolves.toMatchObject(OUTDATED);
  });

  it("leaves what is outside /v1 alone", async () => {
    const session = await drained(
      exports.default.fetch(`${ORIGIN}/api/auth/get-session`, {
        headers: { origin: ORIGIN },
      }),
    );
    expect(session.status).toBe(200);
  });
});
