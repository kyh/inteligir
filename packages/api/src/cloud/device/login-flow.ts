// the one spelling of "this device joins an account": the CLI and the phone both run it and
// inject only where the credential lands. the password crosses the wire once and is held nowhere.

import { postDeviceLogin, type CloudEndpoint, type CloudFailure } from "../cloud-client";
import { normalizeDeviceName, type DeviceCredential } from "./device-schema";

export interface DeviceCredentialStore {
  write(credential: DeviceCredential): Promise<void>;
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

export async function loginDevice(args: LoginDeviceArgs): Promise<LoginOutcome> {
  const result = await postDeviceLogin(args.client, {
    email: args.email,
    password: args.password,
    deviceName: normalizeDeviceName(args.deviceName),
  });
  if (!result.ok) {
    return { kind: "refused", failure: result.failure };
  }
  await args.store.write(result.value);
  return { kind: "logged-in", credential: result.value };
}
