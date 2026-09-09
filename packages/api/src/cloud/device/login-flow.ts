// the one spelling of "this device joins an account": the CLI and the phone both run it and
// inject only where the credential lands. the password crosses the wire once and is held nowhere.

import { postDeviceLogin } from "../cloud-client";
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
  await args.store.write(result.value);
  return { credential: result.value, kind: "logged-in" };
};
