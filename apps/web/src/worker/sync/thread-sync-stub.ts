import type { ThreadSyncDO } from "./thread-sync-do";

export const threadSyncStub = (env: Env, userId: string): DurableObjectStub<ThreadSyncDO> =>
  env.THREAD_SYNC.getByName(`user:${userId}`);

// a failure propagates so beforeDelete aborts and the account survives to retry
export const purgeThreadSync = async (env: Env, userId: string): Promise<void> => {
  await threadSyncStub(env, userId).purge();
};

// best-effort: the revoke is already committed in D1, so a failure costs a stale socket, never a working credential
export const severDeviceSockets = async (
  env: Env,
  userId: string,
  deviceId: string,
): Promise<void> => {
  try {
    await threadSyncStub(env, userId).severDevice(deviceId);
  } catch {
    // the revoke already stands
  }
};

// best-effort like the sever: a lost ping costs staleness until the next poll
export const pingVaultAdvanced = async (
  env: Env,
  userId: string,
  pushingDeviceId: string,
): Promise<void> => {
  try {
    await threadSyncStub(env, userId).vaultPing(pushingDeviceId);
  } catch {
    // the push already stands
  }
};
