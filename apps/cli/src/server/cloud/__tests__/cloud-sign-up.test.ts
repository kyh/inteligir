import { statSync } from "node:fs";
import { isDefinedError, safe } from "@orpc/client";
import { describe, expect, it } from "vitest";
import { bootTestApp } from "../../__tests__/boot-app";
import type { BootedTestApp } from "../../__tests__/boot-app";
import { deviceCredentialPath, readDeviceCredential } from "../credential-store";
import { FAKE_ACCOUNT, FAKE_INVITE_CODE, FakeCloud } from "./fake-cloud";

const NEW_ACCOUNT = {
  email: "new@example.test",
  inviteCode: FAKE_INVITE_CODE,
  name: "New Person",
  password: "a fresh passphrase",
};

const boot = async (cloud: FakeCloud): Promise<BootedTestApp> =>
  await bootTestApp({ cloudTransport: { fetch: cloud.fetch, pollIntervalMs: null } });

describe("cloud.signUp over the router", () => {
  it("creates the account, keeps the credential at 0600, and answers signed in as it", async () => {
    const cloud = new FakeCloud();
    const app = await boot(cloud);

    const status = await app.client.cloud.signUp({ ...NEW_ACCOUNT, deviceName: "Laptop" });
    expect(status.state).toBe("signed-in");
    // oxlint-disable-next-line no-bitwise -- a file mode is a bit field; the mask reads the permission bits
    expect(statSync(deviceCredentialPath(app.dataDir)).mode & 0o777).toBe(0o600);
    expect(readDeviceCredential(app.dataDir)?.deviceId).toBe("dev_1");
    const signedIn = await app.client.cloud.status();
    expect(signedIn.state === "signed-in" && signedIn.accountEmail).toBe(NEW_ACCOUNT.email);
  });

  it("refuses an invite code that will not work as FORBIDDEN and keeps no credential", async () => {
    const cloud = new FakeCloud();
    const app = await boot(cloud);
    const [refusal] = await safe(
      app.client.cloud.signUp({ ...NEW_ACCOUNT, inviteCode: "NOT-THE-CODE" }),
    );
    expect(isDefinedError(refusal) && refusal.code).toBe("FORBIDDEN");
    expect(isDefinedError(refusal) && refusal.message).toBe(
      "That invite code isn't valid. Check it and try again.",
    );
    expect(readDeviceCredential(app.dataDir)).toBeNull();
    const signedOut = await app.client.cloud.status();
    expect(signedOut.state).toBe("signed-out");
  });

  it("refuses an address that already has an account as CONFLICT", async () => {
    const cloud = new FakeCloud();
    const app = await boot(cloud);
    const [refusal] = await safe(
      app.client.cloud.signUp({ ...NEW_ACCOUNT, email: FAKE_ACCOUNT.email }),
    );
    expect(isDefinedError(refusal) && refusal.code).toBe("CONFLICT");
    expect(readDeviceCredential(app.dataDir)).toBeNull();
  });

  it("refuses a shut invite window as TOO_MANY_REQUESTS", async () => {
    const cloud = new FakeCloud();
    cloud.signUpWindowShut = true;
    const app = await boot(cloud);
    const [refusal] = await safe(app.client.cloud.signUp(NEW_ACCOUNT));
    expect(isDefinedError(refusal) && refusal.code).toBe("TOO_MANY_REQUESTS");
  });

  it("reports a cloud that does not answer as PROVIDER_UNAVAILABLE", async () => {
    const app = await bootTestApp({
      cloudTransport: {
        fetch: async () => await Promise.reject(new Error("network is down")),
        pollIntervalMs: null,
      },
    });
    const [refusal] = await safe(app.client.cloud.signUp(NEW_ACCOUNT));
    expect(isDefinedError(refusal) && refusal.code).toBe("PROVIDER_UNAVAILABLE");
    expect(isDefinedError(refusal) && refusal.message).toContain("network is down");
    expect(readDeviceCredential(app.dataDir)).toBeNull();
  });
});
