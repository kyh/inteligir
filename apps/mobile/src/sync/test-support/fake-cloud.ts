import type { CloudClient, CloudResult } from "@repo/contract/cloud/client";
import type { ListDevicesResponse } from "@repo/contract/cloud/device/device-schema";
import { fakeCloudClient, ok } from "@repo/contract/cloud/test-support/fake-cloud-client";

export { ok } from "@repo/contract/cloud/test-support/fake-cloud-client";

export interface FakeCloud {
  client: CloudClient;
  // how many times the sign-in was checked
  checks: number;
  // answered in order, then a live sign-in
  checkResults: CloudResult<ListDevicesResponse>[];
}

const LIVE: ListDevicesResponse = { devices: [] };

// `vault` answers the vault reads in place of an empty tree
export const createFakeCloud = (vault: Partial<CloudClient> = {}): FakeCloud => {
  const fake: FakeCloud = {
    checkResults: [],
    checks: 0,
    client: fakeCloudClient({
      listDevices: async () => {
        fake.checks += 1;
        return fake.checkResults.shift() ?? ok(LIVE);
      },
      signOut: async () => ok({ revoked: true }),
      vaultFile: async () => ({
        failure: { code: "not-found", kind: "refused", message: "empty fake" },
        ok: false,
      }),
      vaultTree: async () => ok({ commit: "0".repeat(40), entries: [], next: null }),
      ...vault,
    }),
  };
  return fake;
};
