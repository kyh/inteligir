import type { AccountSocketDO } from "./account-socket-do";

export const accountSocketStub = (env: Env, userId: string): DurableObjectStub<AccountSocketDO> =>
  env.ACCOUNT_SOCKET.getByName(`user:${userId}`);

// a failure propagates so beforeDelete aborts and the account survives to retry
export const closeAccountSockets = async (env: Env, userId: string): Promise<void> => {
  await accountSocketStub(env, userId).closeAll();
};

// best-effort: the revoke is already committed in D1, so a failure costs a stale socket, never a working credential
export const severDeviceSockets = async (
  env: Env,
  userId: string,
  deviceId: string,
): Promise<void> => {
  try {
    await accountSocketStub(env, userId).severDevice(deviceId);
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
    await accountSocketStub(env, userId).vaultPing(pushingDeviceId);
  } catch {
    // the push already stands
  }
};
