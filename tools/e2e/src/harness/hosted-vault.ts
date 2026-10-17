import { expect } from "./assert";
import { OWNER } from "./cloud-account";
import { gitIn } from "./exec";
import type { AppInstance, InstanceApi } from "./instance";
import { pollUntil } from "./poll";
import { NO_AUTO_SYNC } from "./vault-sync";

const SYNC_DEADLINE_MS = 20_000;
const POLL_INTERVAL_MS = 200;

export const hostedVaultEnv = (origin: string) => ({
  INTELIGIR_CLOUD_URL: origin,
  ...NO_AUTO_SYNC,
});

export const signInOwner = async (
  app: AppInstance,
  label: string,
  deviceName: string,
): Promise<void> => {
  const signedIn = await app.api.cloud.login({ ...OWNER, deviceName });
  // named by email, so a device signed in as another account never passes
  expect(
    signedIn.state === "signed-in" && signedIn.accountEmail === OWNER.email,
    `${label}'s login answered ${JSON.stringify(signedIn)}`,
  );
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

// the conflict copies a Mac's tree tracks, by the name a copy is given, joined for a message
export const conflictCopies = async (mac: AppInstance): Promise<string> => {
  const tracked = await gitIn(mac.vaultDir, ["ls-files"]);
  return tracked
    .split("\n")
    .filter((file) => file.includes("(conflict,"))
    .join(", ");
};
