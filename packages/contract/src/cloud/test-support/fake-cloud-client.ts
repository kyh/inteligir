import type { ClientBuild } from "../client-build";
import type { CloudClient, CloudResult } from "../cloud-client";

export const ok = <T>(value: T): CloudResult<T> => ({ ok: true, value });

export const unreachable = async <T>(): Promise<CloudResult<T>> =>
  await Promise.resolve({ failure: { kind: "unreachable", message: "fake" }, ok: false });

// every method the test does not name answers unreachable, so a method the client grows is one
// default line here rather than an edit to every fake
export const fakeCloudClient = (answers: Partial<CloudClient> = {}): CloudClient => ({
  ackCaptures: unreachable,
  ackDispatches: unreachable,
  cancelDispatch: unreachable,
  claimCaptures: unreachable,
  claimDispatches: unreachable,
  closeApproval: unreachable,
  createCapture: unreachable,
  createDispatch: unreachable,
  deleteAccount: unreachable,
  dispatchStatus: unreachable,
  listApprovals: unreachable,
  listDevices: unreachable,
  openApproval: unreachable,
  pull: unreachable,
  push: unreachable,
  revokeDevice: unreachable,
  signOut: unreachable,
  vaultAsset: unreachable,
  vaultCommit: unreachable,
  vaultFile: unreachable,
  vaultFiles: unreachable,
  vaultTree: unreachable,
  ...answers,
});

// what a test client says it is; only the Worker reads it, and a test of the floor names its own
export const TEST_BUILD: ClientBuild = { platform: "desktop", version: "0.0.0" };
