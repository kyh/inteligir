// not in inteligir.db (the thread log this credential uploads) and not in the
// vault (a git repo pushed to a remote the user chose). the mode is re-applied
// on every write: writeFileSync's mode is ignored for an existing file.

import { readFileSync, rmSync } from "node:fs";
import { stagedWriteFileSync } from "../staged-write";
import { join } from "node:path";
import { deviceCredentialSchema } from "@repo/api/cloud/pairing/pairing-schema";
import { z } from "zod";
import { errnoCode } from "../errno";

export const DEVICE_CREDENTIAL_FILE_NAME = "device-credential";

const CREDENTIAL_FILE_MODE = 0o600;

const storedCredentialSchema = deviceCredentialSchema.extend({
  /** learned from /v1/account after the session opens; the redeem's wire predates the field. */
  userId: z.string().min(1).optional(),
});

export type DeviceCredential = z.infer<typeof storedCredentialSchema>;

export function deviceCredentialPath(dataDir: string): string {
  return join(dataDir, DEVICE_CREDENTIAL_FILE_NAME);
}

export function readDeviceCredential(dataDir: string): DeviceCredential | null {
  let raw: string;
  try {
    raw = readFileSync(deviceCredentialPath(dataDir), "utf8");
  } catch (error) {
    if (errnoCode(error) === "ENOENT" || errnoCode(error) === "EACCES") {
      return null;
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = storedCredentialSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

// the only plaintext copy anywhere: a torn write reads back as "never paired".
export function writeDeviceCredential(dataDir: string, credential: DeviceCredential): void {
  const path = deviceCredentialPath(dataDir);
  stagedWriteFileSync(path, `${JSON.stringify(credential)}\n`, { mode: CREDENTIAL_FILE_MODE });
}

export function clearDeviceCredential(dataDir: string): void {
  rmSync(deviceCredentialPath(dataDir), { force: true });
}
