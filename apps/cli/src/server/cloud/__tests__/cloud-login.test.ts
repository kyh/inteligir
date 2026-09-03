import { statSync } from "node:fs";
import { isDefinedError, safe } from "@orpc/client";
import { describe, expect, it } from "vitest";
import { bootTestApp, type BootedTestApp } from "../../__tests__/boot-app";
import { deviceCredentialPath, readDeviceCredential } from "../credential-store";
import { FAKE_ACCOUNT, FakeCloud } from "./fake-cloud";

async function boot(cloud: FakeCloud): Promise<BootedTestApp> {
  return await bootTestApp({ cloudTransport: { fetch: cloud.fetch, pollIntervalMs: null } });
}

describe("cloud.login over the router", () => {
  it("signs in, keeps the credential at 0600, and answers the paired status", async () => {
    const cloud = new FakeCloud();
    const app = await boot(cloud);

    const status = await app.client.cloud.login({ ...FAKE_ACCOUNT, deviceName: "Laptop" });
    expect(status.state).toBe("paired");
    expect(statSync(deviceCredentialPath(app.dataDir)).mode & 0o777).toBe(0o600);
    expect(readDeviceCredential(app.dataDir)?.deviceId).toBe("dev_1");
    expect((await app.client.cloud.status()).state).toBe("paired");
  });

  it("refuses a wrong password as UNAUTHORIZED and keeps no credential", async () => {
    const cloud = new FakeCloud();
    const app = await boot(cloud);
    const [refusal] = await safe(
      app.client.cloud.login({ email: FAKE_ACCOUNT.email, password: "not-the-password" }),
    );
    expect(isDefinedError(refusal) && refusal.code).toBe("UNAUTHORIZED");
    expect(isDefinedError(refusal) && refusal.message).toBe("Wrong email or password.");
    expect(readDeviceCredential(app.dataDir)).toBeNull();
    expect((await app.client.cloud.status()).state).toBe("off");
  });

  it("refuses the account's device cap as CONFLICT", async () => {
    const cloud = new FakeCloud();
    cloud.maxDevices = 0;
    const app = await boot(cloud);
    const [refusal] = await safe(app.client.cloud.login(FAKE_ACCOUNT));
    expect(isDefinedError(refusal) && refusal.code).toBe("CONFLICT");
  });

  it("refuses a shut login window as TOO_MANY_REQUESTS", async () => {
    const cloud = new FakeCloud();
    cloud.loginWindowShut = true;
    const app = await boot(cloud);
    const [refusal] = await safe(app.client.cloud.login(FAKE_ACCOUNT));
    expect(isDefinedError(refusal) && refusal.code).toBe("TOO_MANY_REQUESTS");
  });

  it("reports a cloud that does not answer as PROVIDER_UNAVAILABLE", async () => {
    const app = await bootTestApp({
      cloudTransport: {
        fetch: () => Promise.reject(new Error("network is down")),
        pollIntervalMs: null,
      },
    });
    const [refusal] = await safe(app.client.cloud.login(FAKE_ACCOUNT));
    expect(isDefinedError(refusal) && refusal.code).toBe("PROVIDER_UNAVAILABLE");
    expect(isDefinedError(refusal) && refusal.message).toContain("network is down");
    expect(readDeviceCredential(app.dataDir)).toBeNull();
  });
});
