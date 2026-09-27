import type { VaultStatusResponse } from "@repo/api/local/vault/vault-schema";
import { expect } from "./assert";
import type { InstanceApi } from "./instance";

// every sync is an explicit call, so what each instance holds, and the divergence between two, is
// what the lines before it produced.
export const NO_AUTO_SYNC = { INTELIGIR_SYNC_INTERVAL_MS: "0" };

// one pass, never retried: with no loop running beside it, anything but clean is the answer.
export const syncExpectClean = async (
  api: InstanceApi,
  label: string,
): Promise<VaultStatusResponse> => {
  const status = await api.vault.syncNow();
  expect(
    status.state === "clean",
    `${label}: expected a clean sync, got "${status.state}" (lastError: ${status.lastError ?? "none"})`,
  );
  return status;
};
