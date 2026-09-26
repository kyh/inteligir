import { isDefinedError, safe } from "@orpc/client";
import type { CloudFetch } from "@repo/api/cloud/client";
import { DEVICE_API_PATHS, deviceLoginResponseSchema } from "@repo/api/cloud/device/device-schema";
import { describe, expect, it } from "vitest";
import { bootTestApp } from "../../__tests__/boot-app";
import type { BootedTestApp } from "../../__tests__/boot-app";
import { FAKE_ACCOUNT, FakeCloud } from "./fake-cloud";

const boot = async (fetch: CloudFetch): Promise<BootedTestApp> =>
  await bootTestApp({ cloudTransport: { fetch, pollIntervalMs: null } });

const signedInMac = async (cloud: FakeCloud): Promise<BootedTestApp> => {
  const app = await boot(cloud.fetch);
  await app.client.cloud.login({ ...FAKE_ACCOUNT, deviceName: "Mac" });
  return app;
};

// another device joining the account on its own, as a phone would
const signInElsewhere = async (cloud: FakeCloud, deviceName: string): Promise<string> => {
  const response = await cloud.fetch(`https://cloud.test${DEVICE_API_PATHS.login}`, {
    body: JSON.stringify({ ...FAKE_ACCOUNT, deviceName }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return deviceLoginResponseSchema.parse(await response.json()).deviceId;
};

const revokeRequests = (cloud: FakeCloud): number =>
  cloud.requests.filter((route) => route === `POST ${DEVICE_API_PATHS.revoke}`).length;

describe("cloud.devices", () => {
  it("lists the account's signed-in devices, this Mac marked current and revoked ones left out", async () => {
    const cloud = new FakeCloud();
    const app = await signedInMac(cloud);
    const phone = await signInElsewhere(cloud, "Phone");
    const lost = await signInElsewhere(cloud, "Old iPad");
    cloud.revoke(lost);

    const { devices } = await app.client.cloud.devices();
    expect(devices.map(({ current, id, name }) => ({ current, id, name }))).toEqual([
      { current: true, id: "dev_1", name: "Mac" },
      { current: false, id: phone, name: "Phone" },
    ]);
  });

  it("moves the status to unauthorized when the cloud refuses this Mac's credential", async () => {
    const cloud = new FakeCloud();
    const app = await signedInMac(cloud);
    cloud.revoke("dev_1");

    const [refusal] = await safe(app.client.cloud.devices());
    expect(isDefinedError(refusal) && refusal.code).toBe("PRECONDITION_FAILED");
    expect(isDefinedError(refusal) && refusal.message).toBe(
      "This Mac was signed out of your account.",
    );
    const status = await app.client.cloud.status();
    expect(status.state).toBe("unauthorized");
  });

  it("says a cloud it cannot reach is unavailable, and keeps the sign-in", async () => {
    const cloud = new FakeCloud();
    let reachable = true;
    const app = await boot(async (input, init) =>
      reachable ? await cloud.fetch(input, init) : await Promise.reject(new Error("offline")),
    );
    await app.client.cloud.login(FAKE_ACCOUNT);
    reachable = false;

    const [refusal] = await safe(app.client.cloud.devices());
    expect(isDefinedError(refusal) && refusal.code).toBe("PROVIDER_UNAVAILABLE");
    expect(isDefinedError(refusal) && refusal.message).toContain("offline");
    const status = await app.client.cloud.status();
    expect(status.state).toBe("signed-in");
  });

  it("asks nothing signed out", async () => {
    const cloud = new FakeCloud();
    const app = await boot(cloud.fetch);

    const [refusal] = await safe(app.client.cloud.devices());
    expect(isDefinedError(refusal) && refusal.code).toBe("PRECONDITION_FAILED");
    expect(cloud.requests).toEqual([]);
  });
});

describe("cloud.revokeDevice", () => {
  it("cuts another device off: the cloud refuses it and the list leaves it out", async () => {
    const cloud = new FakeCloud();
    const app = await signedInMac(cloud);
    const phone = await signInElsewhere(cloud, "Lost Phone");

    expect(await app.client.cloud.revokeDevice({ deviceId: phone })).toEqual({ revoked: true });
    expect(cloud.activeDeviceCount()).toBe(1);
    const { devices } = await app.client.cloud.devices();
    expect(devices.map((device) => device.id)).toEqual(["dev_1"]);
  });

  it("refuses this Mac's own id without asking the cloud: this Mac signs out instead", async () => {
    const cloud = new FakeCloud();
    const app = await signedInMac(cloud);

    const [refusal] = await safe(app.client.cloud.revokeDevice({ deviceId: "dev_1" }));
    expect(isDefinedError(refusal) && refusal.code).toBe("BAD_REQUEST");
    expect(revokeRequests(cloud)).toBe(0);
    expect(cloud.activeDeviceCount()).toBe(1);
  });

  it("answers a device the account no longer has as NOT_FOUND", async () => {
    const cloud = new FakeCloud();
    const app = await signedInMac(cloud);
    const phone = await signInElsewhere(cloud, "Phone");
    cloud.revoke(phone);

    const [refusal] = await safe(app.client.cloud.revokeDevice({ deviceId: phone }));
    expect(isDefinedError(refusal) && refusal.code).toBe("NOT_FOUND");
    const status = await app.client.cloud.status();
    expect(status.state === "signed-in" && status.lastError).toBeNull();
  });

  it("moves the status to unauthorized when the cloud refuses this Mac's credential", async () => {
    const cloud = new FakeCloud();
    const app = await signedInMac(cloud);
    const phone = await signInElsewhere(cloud, "Phone");
    cloud.revoke("dev_1");

    const [refusal] = await safe(app.client.cloud.revokeDevice({ deviceId: phone }));
    expect(isDefinedError(refusal) && refusal.code).toBe("PRECONDITION_FAILED");
    const status = await app.client.cloud.status();
    expect(status.state).toBe("unauthorized");
    expect(cloud.activeDeviceCount()).toBe(1);
  });

  it("says a cloud it cannot reach is unavailable", async () => {
    const cloud = new FakeCloud();
    let reachable = true;
    const app = await boot(async (input, init) =>
      reachable ? await cloud.fetch(input, init) : await Promise.reject(new Error("offline")),
    );
    await app.client.cloud.login(FAKE_ACCOUNT);
    const phone = await signInElsewhere(cloud, "Phone");
    reachable = false;

    const [refusal] = await safe(app.client.cloud.revokeDevice({ deviceId: phone }));
    expect(isDefinedError(refusal) && refusal.code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("asks nothing signed out", async () => {
    const cloud = new FakeCloud();
    const app = await boot(cloud.fetch);

    const [refusal] = await safe(app.client.cloud.revokeDevice({ deviceId: "dev_9" }));
    expect(isDefinedError(refusal) && refusal.code).toBe("PRECONDITION_FAILED");
    expect(cloud.requests).toEqual([]);
  });
});
