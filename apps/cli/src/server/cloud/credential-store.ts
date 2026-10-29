// not in inteligir.db (a boot replaces a file on a history this build lacks, and
// the sign-in outlives that) and not in the vault (a git repo pushed to a remote
// the user chose). the mode is re-applied on every write: writeFileSync's mode is
// ignored for an existing file.

import { rmSync } from "node:fs";
import { stagedWriteFileSync } from "../staged-write";
import nodePath from "node:path";
import { deviceLoginResponseSchema } from "@repo/contract/cloud/device/device-schema";
import { z } from "zod";
import { readJsonFile } from "../json-file-store";

export const DEVICE_CREDENTIAL_FILE_NAME = "device-credential";

const CREDENTIAL_FILE_MODE = 0o600;

// the login's answer and the name this device signed in under, which its commits carry. every field
// is required: a file that cannot name its account reads as signed out, never as a sign-in the
// vault's account fence cannot judge.
const storedCredentialSchema = deviceLoginResponseSchema
  .extend({ deviceName: z.string().min(1) })
  .strict();

export type DeviceCredential = z.infer<typeof storedCredentialSchema>;

export const deviceCredentialPath = (dataDir: string): string =>
  nodePath.join(dataDir, DEVICE_CREDENTIAL_FILE_NAME);

export const readDeviceCredential = (dataDir: string): DeviceCredential | null => {
  const read = readJsonFile(deviceCredentialPath(dataDir), storedCredentialSchema);
  if (read.kind === "unreadable" && read.code !== "EACCES") {
    throw read.error;
  }
  return read.kind === "ok" ? read.value : null;
};

// the only plaintext copy anywhere: a torn write reads back as "never signed in".
export const writeDeviceCredential = (dataDir: string, credential: DeviceCredential): void => {
  const path = deviceCredentialPath(dataDir);
  stagedWriteFileSync(path, `${JSON.stringify(credential)}\n`, { mode: CREDENTIAL_FILE_MODE });
};

export const clearDeviceCredential = (dataDir: string): void => {
  rmSync(deviceCredentialPath(dataDir), { force: true });
};
