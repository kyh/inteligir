// THE DEVICE CREDENTIAL IS A SECRET AT REST, and where it does NOT go is most
// of this module's design.
//
// NOT the database. `inteligir.db` holds the thread log this credential
// EXISTS to upload; a credential inside it would ride its own sync to every
// other device on the account and to whatever the cloud keeps.
//
// NOT the vault. The vault is a git repo the sync loop pushes to a remote the
// user chose, so a secret in it is a secret in someone's GitHub.
//
// So it lives beside `server.json` in the data dir, at the same 0600 and
// for the same reason — and, like that file, the mode is re-applied on every
// write, because `writeFileSync`'s `mode` is ignored for a file that already
// exists and a credential inherited from a laxer umask would keep it forever.
//
// It is a BEARER token: unlike the instance secret it is presented whole on
// every call, because the cloud verifies it by hashing what arrives (there is
// no shared secret to challenge with across a network the server does not
// trust). The mitigations are the server's — revocation bites on the next
// request, and the plaintext is stored nowhere but here.

import { readFileSync, rmSync } from "node:fs";
import { stagedWriteFileSync } from "../staged-write";
import { join } from "node:path";
import { DEVICE_CREDENTIAL_PATTERN } from "@repo/api/cloud/pairing/pairing-schema";
import { z } from "zod";
import { errnoCode } from "../errno";

export const DEVICE_CREDENTIAL_FILE_NAME = "device-credential";

/** Owner read/write — see the header. */
const CREDENTIAL_FILE_MODE = 0o600;

/**
 * What the file holds. Parsed rather than trusted: this is the boundary
 * between bytes on a disk anyone with the user's account can edit and a value
 * the sync runtime puts in an `Authorization` header, and a malformed file
 * must read as "not paired" rather than as a credential the cloud will refuse
 * on every request forever.
 */
const storedCredentialSchema = z
  .object({
    deviceId: z.string().min(1),
    credential: z.string().regex(DEVICE_CREDENTIAL_PATTERN),
    /** The account this credential belongs to, learned from `/v1/account`
     *  after the session opens (the redeem answers no identity — its wire
     *  predates the field and may never break). Absent until that fetch
     *  lands; the vault's cross-account fence stays inert without it. */
    userId: z.string().min(1).optional(),
  })
  .strict();

export type DeviceCredential = z.infer<typeof storedCredentialSchema>;

export function deviceCredentialPath(dataDir: string): string {
  return join(dataDir, DEVICE_CREDENTIAL_FILE_NAME);
}

/** The credential this data dir holds, or null when there is none to read —
 *  never paired, unpaired since, or a file this process may not read. */
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

/**
 * Write it ATOMICALLY — temp file in the same directory, then rename over.
 *
 * This file is the only plaintext copy of the credential that exists anywhere:
 * the cloud keeps a hash, and the pairing code that produced it was consumed in
 * one atomic server-side statement and cannot be redeemed twice. So a torn
 * write is not a retryable failure, it is a pairing destroyed — and it would
 * destroy it SILENTLY, because a half-written file reads back as "never
 * paired". The rename is same-directory so it stays within one filesystem,
 * which is what makes it atomic.
 */
export function writeDeviceCredential(dataDir: string, credential: DeviceCredential): void {
  const path = deviceCredentialPath(dataDir);
  stagedWriteFileSync(path, `${JSON.stringify(credential)}\n`, { mode: CREDENTIAL_FILE_MODE });
}

export function clearDeviceCredential(dataDir: string): void {
  rmSync(deviceCredentialPath(dataDir), { force: true });
}
