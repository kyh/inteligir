import { expect } from "./assert";
import { OWNER } from "./cloud-account";
import type { AppInstance, InstanceApi } from "./instance";
import { pollUntil } from "./poll";
import { NO_AUTO_SYNC } from "./vault-sync";

const IDENTITY_DEADLINE_MS = 15_000;
const SYNC_DEADLINE_MS = 20_000;
const POLL_INTERVAL_MS = 200;

export const hostedVaultEnv = (origin: string) => ({
  INTELIGIR_CLOUD_URL: origin,
  ...NO_AUTO_SYNC,
});

// the account identity lands asynchronously after the login, and the cross-account fence fails closed
// until it does; named by email, so a device signed in as another account never passes.
export const untilIdentityKnown = async (api: InstanceApi, label: string): Promise<void> => {
  await pollUntil(
    async () => await api.cloud.status(),
    (status) => status.state === "signed-in" && status.accountEmail === OWNER.email,
    {
      deadlineMs: IDENTITY_DEADLINE_MS,
      describe: (status) =>
        `${label} never answered signed in as ${OWNER.email} within ${IDENTITY_DEADLINE_MS}ms: ${JSON.stringify(status)}`,
      intervalMs: POLL_INTERVAL_MS,
    },
  );
};

export const signInOwner = async (
  app: AppInstance,
  label: string,
  deviceName: string,
): Promise<void> => {
  const signedIn = await app.api.cloud.login({ ...OWNER, deviceName });
  expect(signedIn.state === "signed-in", `${label}'s login answered ${signedIn.state}`);
  await untilIdentityKnown(app.api, label);
};

// syncNow coalesces: a call landing during a background pass has it run once more, so the answer
// covers every change made before the call. "dirty" is a push that lost a race to another device's,
// which the next pass integrates, so retry; any other state fails at once.
export const syncUntil = async (
  api: InstanceApi,
  label: string,
  wanted: "clean" | "unauthorized",
): Promise<void> => {
  const transitional = new Set([
    "syncing",
    "dirty",
    ...(wanted === "unauthorized" ? ["clean"] : []),
  ]);
  await pollUntil(
    async () => await api.vault.syncNow(),
    (status) => {
      expect(
        status.state === wanted || transitional.has(status.state),
        `${label}: expected "${wanted}", got "${status.state}" (lastError: ${status.lastError ?? "none"})`,
      );
      return status.state === wanted;
    },
    {
      deadlineMs: SYNC_DEADLINE_MS,
      describe: (status) =>
        `${label}: still "${status.state}" after ${SYNC_DEADLINE_MS}ms waiting for "${wanted}"`,
      intervalMs: POLL_INTERVAL_MS,
    },
  );
};
