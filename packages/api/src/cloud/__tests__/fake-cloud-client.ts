import type { CloudClient, CloudResult } from "../cloud-client";

export const unreachable = async <T>(): Promise<CloudResult<T>> => ({
  failure: { kind: "unreachable", message: "fake" },
  ok: false,
});

// every method the test does not name answers unreachable, so a method the client grows is one
// default line here rather than an edit to every fake
export const fakeCloudClient = (answers: Partial<CloudClient> = {}): CloudClient => ({
  account: unreachable,
  ackCaptures: unreachable,
  ackDispatches: unreachable,
  cancelDispatch: unreachable,
  claimCaptures: unreachable,
  claimDispatches: unreachable,
  closeApproval: unreachable,
  createCapture: unreachable,
  createDispatch: unreachable,
  dispatchStatus: unreachable,
  listApprovals: unreachable,
  listDevices: unreachable,
  openApproval: unreachable,
  pull: unreachable,
  push: unreachable,
  revokeDevice: unreachable,
  signOut: unreachable,
  vaultAsset: unreachable,
  vaultAssetSource: () => ({ headers: {}, uri: "https://cloud.test/fake" }),
  vaultCommit: unreachable,
  vaultFile: unreachable,
  vaultFiles: unreachable,
  vaultTree: unreachable,
  ...answers,
});
