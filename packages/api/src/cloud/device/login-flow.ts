// the one spelling of "this device joins an account": the CLI and the phone both run it and
// inject only where the credential lands. the password crosses the wire once and is held nowhere.

import { createCloudClient, postDeviceLogin } from "../cloud-client";
import type { CloudEndpoint, CloudFailure } from "../cloud-client";
import { normalizeDeviceName } from "./device-schema";
import type { DeviceCredential } from "./device-schema";

export interface DeviceCredentialStore {
  write: (credential: DeviceCredential) => Promise<void>;
}

export interface LoginDeviceArgs {
  // no bearer yet: the answer is the first credential this device holds
  client: CloudEndpoint;
  store: DeviceCredentialStore;
  email: string;
  password: string;
  deviceName: string;
}

export type LoginOutcome =
  | { kind: "logged-in"; credential: DeviceCredential }
  | { kind: "refused"; failure: CloudFailure };

export const loginDevice = async (args: LoginDeviceArgs): Promise<LoginOutcome> => {
  const result = await postDeviceLogin(args.client, {
    deviceName: normalizeDeviceName(args.deviceName),
    email: args.email,
    password: args.password,
  });
  if (!result.ok) {
    return { failure: result.failure, kind: "refused" };
  }
  try {
    await args.store.write(result.value);
  } catch (error) {
    // the cloud already counts this device against the account's cap; a credential nobody
    // kept can only give its slot back now. the store's error is the one worth reporting.
    await createCloudClient({ ...args.client, credential: result.value.credential }).signOut();
    throw error;
  }
  return { credential: result.value, kind: "logged-in" };
};
