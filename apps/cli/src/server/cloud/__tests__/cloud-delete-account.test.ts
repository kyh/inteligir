import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { isDefinedError, safe } from "@orpc/client";
import { ACCOUNT_API_PATHS } from "@repo/api/cloud/account/account-schema";
import { DEVICE_API_PATHS } from "@repo/api/cloud/device/device-schema";
import type { CloudFetch } from "@repo/api/cloud/client";
import { describe, expect, it } from "vitest";
import { bootTestApp } from "../../__tests__/boot-app";
import type { BootedTestApp } from "../../__tests__/boot-app";
import { deviceCredentialPath, readDeviceCredential } from "../credential-store";
import { createVaultRemoteProvider, NO_ORIGIN } from "../vault-remote";
import { FAKE_ACCOUNT, FakeCloud } from "./fake-cloud";

const RIGHT_PASSWORD = { password: FAKE_ACCOUNT.password };

const boot = async (fetch: CloudFetch): Promise<BootedTestApp> =>
  await bootTestApp({ cloudTransport: { fetch, pollIntervalMs: null } });

const signedInMac = async (cloud: FakeCloud): Promise<BootedTestApp> => {
  const app = await boot(cloud.fetch);
  await app.client.cloud.login({ ...FAKE_ACCOUNT, deviceName: "Mac" });
  return app;
};

// the account's hosted vault, as the vault engine derives it from the data dir each pass
const accountRemote = (app: BootedTestApp) =>
  createVaultRemoteProvider({
    cloudUrl: app.config.cloudUrl,
    dataDir: app.dataDir,
    externalSync: null,
    pinnedRemote: null,
  })(NO_ORIGIN);

describe("cloud.deleteAccount", () => {
  it("ends the account and forgets this Mac's sign-in, leaving the vault as it is", async () => {
    const cloud = new FakeCloud();
    const app = await signedInMac(cloud);
    await writeFile(path.join(app.vaultDir, "kept.md"), "# kept\n");
    expect(accountRemote(app)?.source).toBe("account");

    const status = await app.client.cloud.deleteAccount(RIGHT_PASSWORD);
    expect(status).toEqual({
      cloudUrl: app.config.cloudUrl,
      revokeError: null,
      state: "signed-out",
    });
    expect(existsSync(deviceCredentialPath(app.dataDir))).toBe(false);
    expect(accountRemote(app)).toBeNull();
    expect(cloud.hasAccount(FAKE_ACCOUNT.email)).toBe(false);
    expect(cloud.deviceCount()).toBe(0);
    // no sign-out follows: the deletion took this device's row with it
    expect(cloud.requests).not.toContain(`POST ${DEVICE_API_PATHS.signOut}`);
    expect(existsSync(path.join(app.vaultDir, "kept.md"))).toBe(true);
  });

  it("lands a deletion whose own revocation a pass met midway, which ended the session", async () => {
    const cloud = new FakeCloud();
    const answered = Promise.withResolvers<null>();
    const released = Promise.withResolvers<null>();
    // the cloud has deleted the account, and its answer is still on the wire; a request aborted
    // meanwhile never reads it
    const app = await boot(async (input, init) => {
      const answer = await cloud.fetch(input, init);
      if (new URL(input).pathname !== ACCOUNT_API_PATHS.delete) {
        return answer;
      }
      answered.resolve(null);
      await released.promise;
      init?.signal?.throwIfAborted();
      return answer;
    });
    await app.client.cloud.login(FAKE_ACCOUNT);

    const deleting = app.client.cloud.deleteAccount(RIGHT_PASSWORD);
    await answered.promise;
    const met = await app.client.cloud.syncNow();
    expect(met.state).toBe("unauthorized");
    released.resolve(null);

    const deleted = await deleting;
    expect(deleted.state).toBe("signed-out");
    expect(existsSync(deviceCredentialPath(app.dataDir))).toBe(false);
  });

  it("refuses a wrong password as UNAUTHORIZED and keeps the sign-in", async () => {
    const cloud = new FakeCloud();
    const app = await signedInMac(cloud);

    const [refusal] = await safe(app.client.cloud.deleteAccount({ password: "not-the-password" }));
    expect(isDefinedError(refusal) && refusal.code).toBe("UNAUTHORIZED");
    expect(isDefinedError(refusal) && refusal.message).toBe("Wrong password.");
    expect(readDeviceCredential(app.dataDir)?.deviceId).toBe("dev_1");
    const status = await app.client.cloud.status();
    expect(status.state === "signed-in" && status.lastError).toBeNull();
    expect(cloud.hasAccount(FAKE_ACCOUNT.email)).toBe(true);
  });

  it("refuses a shut window as TOO_MANY_REQUESTS and keeps the sign-in", async () => {
    const cloud = new FakeCloud();
    const app = await signedInMac(cloud);
    cloud.deleteWindowShut = true;

    const [refusal] = await safe(app.client.cloud.deleteAccount(RIGHT_PASSWORD));
    expect(isDefinedError(refusal) && refusal.code).toBe("TOO_MANY_REQUESTS");
    expect(readDeviceCredential(app.dataDir)).not.toBeNull();
  });

  it("says a cloud it cannot reach is unavailable, and keeps the sign-in", async () => {
    const cloud = new FakeCloud();
    let reachable = true;
    const app = await boot(async (input, init) =>
      reachable ? await cloud.fetch(input, init) : await Promise.reject(new Error("offline")),
    );
    await app.client.cloud.login(FAKE_ACCOUNT);
    reachable = false;

    const [refusal] = await safe(app.client.cloud.deleteAccount(RIGHT_PASSWORD));
    expect(isDefinedError(refusal) && refusal.code).toBe("PROVIDER_UNAVAILABLE");
    expect(isDefinedError(refusal) && refusal.message).toContain("offline");
    expect(readDeviceCredential(app.dataDir)?.deviceId).toBe("dev_1");
    const status = await app.client.cloud.status();
    expect(status.state).toBe("signed-in");
  });

  it("moves the status to unauthorized when the cloud refuses this Mac's credential", async () => {
    const cloud = new FakeCloud();
    const app = await signedInMac(cloud);
    cloud.revoke("dev_1");

    const [refusal] = await safe(app.client.cloud.deleteAccount(RIGHT_PASSWORD));
    expect(isDefinedError(refusal) && refusal.code).toBe("PRECONDITION_FAILED");
    const status = await app.client.cloud.status();
    expect(status.state).toBe("unauthorized");
    expect(cloud.hasAccount(FAKE_ACCOUNT.email)).toBe(true);
  });

  it("asks nothing signed out", async () => {
    const cloud = new FakeCloud();
    const app = await boot(cloud.fetch);

    const [refusal] = await safe(app.client.cloud.deleteAccount(RIGHT_PASSWORD));
    expect(isDefinedError(refusal) && refusal.code).toBe("PRECONDITION_FAILED");
    expect(cloud.requests).toEqual([]);
  });
});
