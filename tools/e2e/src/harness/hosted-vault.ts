import { expect } from "./assert";
import type { InstanceApi } from "./instance";
import { pollUntil } from "./poll";

const IDENTITY_DEADLINE_MS = 15_000;
const SYNC_DEADLINE_MS = 20_000;
const POLL_INTERVAL_MS = 200;

// auto-sync off: every sync is an explicit call, so each assertion reads the state the previous
// line produced.
export const hostedVaultEnv = (origin: string) => ({
  INTELIGIR_CLOUD_URL: origin,
  INTELIGIR_SYNC_INTERVAL_MS: "0",
});

// the account identity lands asynchronously after the login, and the cross-account fence fails closed
// until it does.
export const untilIdentityKnown = async (api: InstanceApi, label: string): Promise<void> => {
  await pollUntil(
    async () => await api.cloud.status(),
    (status) => status.state === "signed-in" && status.accountEmail !== null,
    {
      deadlineMs: IDENTITY_DEADLINE_MS,
      describe: (status) =>
        `${label}: account identity did not land within ${IDENTITY_DEADLINE_MS}ms (state: ${status.state})`,
      intervalMs: POLL_INTERVAL_MS,
    },
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
