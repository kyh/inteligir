import { existsSync } from "node:fs";
import { isDefinedError, safe } from "@orpc/client";
import { ACCOUNT_API_PATHS } from "@repo/contract/cloud/account/account-schema";
import { DEVICE_API_PATHS } from "@repo/contract/cloud/device/device-schema";
import type { CloudFetch } from "@repo/contract/cloud/client";
import { describe, expect, it } from "vitest";
import { deviceCredentialPath, readDeviceCredential } from "../credential-store";
import { boot, signedInMac } from "./cloud-boot";
import { FAKE_ACCOUNT, FakeCloud } from "./fake-cloud";

const RIGHT_PASSWORD = { password: FAKE_ACCOUNT.password };

// the cloud carries out the first deletion, and its answer never arrives
const lostFirstDeletion = (cloud: FakeCloud): CloudFetch => {
  let lost = false;
  return async (input, init) => {
    const answer = await cloud.fetch(input, init);
    if (lost || new URL(input).pathname !== ACCOUNT_API_PATHS.delete) {
      return answer;
    }
    lost = true;
    throw new Error("the connection was reset");
  };
};

describe("cloud.deleteAccount", () => {
  it("ends the account and forgets this Mac's sign-in, leaving its threads as they are", async () => {
    const cloud = new FakeCloud();
    const app = await signedInMac(cloud);
    const { thread } = await app.client.threads.create({ title: "Kept" });

    const status = await app.client.cloud.deleteAccount(RIGHT_PASSWORD);
    expect(status).toEqual({
      cloudUrl: app.config.cloudUrl,
      revokeError: null,
      state: "signed-out",
    });
    expect(existsSync(deviceCredentialPath(app.dataDir))).toBe(false);
    expect(cloud.hasAccount(FAKE_ACCOUNT.email)).toBe(false);
    expect(cloud.deviceCount()).toBe(0);
    // no sign-out follows: the deletion took this device's row with it
    expect(cloud.requests).not.toContain(`POST ${DEVICE_API_PATHS.signOut}`);
    const kept = await app.client.threads.get({ threadId: thread.id });
    expect(kept.thread.title).toBe("Kept");
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

  it("reads a retry that meets its own lost deletion's revocation as the account gone", async () => {
    const cloud = new FakeCloud();
    const app = await boot(lostFirstDeletion(cloud));
    await app.client.cloud.login(FAKE_ACCOUNT);

    const [lost] = await safe(app.client.cloud.deleteAccount(RIGHT_PASSWORD));
    expect(isDefinedError(lost) && lost.code).toBe("PROVIDER_UNAVAILABLE");
    expect(cloud.hasAccount(FAKE_ACCOUNT.email)).toBe(false);

    const retried = await app.client.cloud.deleteAccount(RIGHT_PASSWORD);
    expect(retried.state).toBe("signed-out");
    expect(existsSync(deviceCredentialPath(app.dataDir))).toBe(false);
  });

  it("reads a retry after a pass met that revocation as the account gone, asking nothing", async () => {
    const cloud = new FakeCloud();
    const app = await boot(lostFirstDeletion(cloud));
    await app.client.cloud.login(FAKE_ACCOUNT);
    await safe(app.client.cloud.deleteAccount(RIGHT_PASSWORD));
    const met = await app.client.cloud.syncNow();
    expect(met.state).toBe("unauthorized");
    const asked = cloud.requests.length;

    const retried = await app.client.cloud.deleteAccount(RIGHT_PASSWORD);
    expect(retried.state).toBe("signed-out");
    expect(cloud.requests).toHaveLength(asked);
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
