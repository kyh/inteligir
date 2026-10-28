import { CLIENT_BUILD_HEADER } from "@repo/contract/cloud/client-build";
import { DEVICE_API_PATHS } from "@repo/contract/cloud/device/device-schema";
import { SYNC_WS_PATH } from "@repo/contract/cloud/sync/sync-ws";
import { VAULT_GIT_PATH } from "@repo/contract/cloud/vault/vault-git";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  deviceHeaders,
  drained,
  loginDevice,
  ORIGIN,
  refusalCodeOf,
  sessionHeaders,
  signUpUser,
} from "./test-support/cloud-helpers";

// any route a device credential reaches
const LIST = `${ORIGIN}${DEVICE_API_PATHS.list}`;
const GIT_REFS = `${ORIGIN}${VAULT_GIT_PATH}/info/refs?service=git-upload-pack`;

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

describe("the client build floor", () => {
  it("refuses a request that names no build, or one it cannot read, as client-outdated", async () => {
    const { credential } = await signedIn("floor-missing@example.test");
    for (const build of [null, "", "0.7.0", "latest+desktop"]) {
      const response = await exports.default.fetch(LIST, { headers: asBuild(credential, build) });
      expect(response.status, String(build)).toBe(426);
      expect(await refusalCodeOf(response)).toBe("client-outdated");
    }
  });

  it("refuses a build below the floor, and its prerelease, before it judges the credential", async () => {
    const { credential } = await signedIn("floor-below@example.test");
    for (const build of [`${below()}+desktop`, `${env.MIN_CLIENT_BUILD}-beta.1+mobile`]) {
      const response = await exports.default.fetch(LIST, { headers: asBuild(credential, build) });
      expect(response.status, build).toBe(426);
      expect(await refusalCodeOf(response)).toBe("client-outdated");
    }
    const anonymous = await drained(
      exports.default.fetch(LIST, {
        headers: { [CLIENT_BUILD_HEADER]: `${below()}+desktop` },
      }),
    );
    expect(anonymous.status).toBe(426);
  });

  it("answers a build at or above the floor, whatever platform it names", async () => {
    const { credential } = await signedIn("floor-at@example.test");
    const at = await drained(exports.default.fetch(LIST, { headers: deviceHeaders(credential) }));
    expect(at.status).toBe(200);
    const above = await drained(
      exports.default.fetch(LIST, {
        headers: asBuild(credential, `${versionAround(1, 0)}+android`),
      }),
    );
    expect(above.status).toBe(200);
  });

  it("refuses the login before it checks the password", async () => {
    const response = await exports.default.fetch(`${ORIGIN}${DEVICE_API_PATHS.login}`, {
      body: JSON.stringify({ deviceName: "Laptop", email: "nobody@example.test", password: "x" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(426);
    expect(await refusalCodeOf(response)).toBe("client-outdated");
  });

  it("refuses the socket's upgrade", async () => {
    const { credential } = await signedIn("floor-socket@example.test");
    const response = await drained(
      exports.default.fetch(`${ORIGIN}${SYNC_WS_PATH}`, {
        headers: { ...asBuild(credential, null), upgrade: "websocket" },
      }),
    );
    expect(response.status).toBe(426);
    expect(response.webSocket).toBeNull();
  });

  it("refuses the git remote in plain text git prints", async () => {
    const { credential } = await signedIn("floor-git@example.test");
    const response = await exports.default.fetch(GIT_REFS, { headers: asBuild(credential, null) });
    expect(response.status).toBe(426);
    expect(response.headers.get("content-type")).toMatch(/^text\/plain/u);
    expect(await response.text()).toMatch(/update/u);
    const current = await drained(
      exports.default.fetch(GIT_REFS, { headers: deviceHeaders(credential) }),
    );
    expect(current.status).not.toBe(426);
  });

  it("answers this Worker's own pages, which ship in the same deploy", async () => {
    const { cookie } = await signedIn("floor-page@example.test");
    const listed = await drained(
      exports.default.fetch(`${ORIGIN}${DEVICE_API_PATHS.list}`, {
        headers: sessionHeaders(cookie),
      }),
    );
    expect(listed.status).toBe(200);
    const crossSite = await drained(
      exports.default.fetch(`${ORIGIN}${DEVICE_API_PATHS.list}`, {
        headers: { ...sessionHeaders(cookie), "sec-fetch-site": "cross-site" },
      }),
    );
    expect(crossSite.status).toBe(426);
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
