import type { CloudFetch } from "@repo/contract/cloud/client";
import { bootTestApp } from "../../__tests__/boot-app";
import type { BootedTestApp } from "../../__tests__/boot-app";
import { FAKE_ACCOUNT } from "./fake-cloud";
import type { FakeCloud } from "./fake-cloud";

// pollIntervalMs: null, so every pass is one the test runs.
export const boot = async (fetch: CloudFetch): Promise<BootedTestApp> =>
  await bootTestApp({ cloudTransport: { fetch, pollIntervalMs: null } });

export const signedInMac = async (cloud: FakeCloud): Promise<BootedTestApp> => {
  const app = await boot(cloud.fetch);
  await app.client.cloud.login({ ...FAKE_ACCOUNT, deviceName: "Mac" });
  return app;
};
