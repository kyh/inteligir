// The device credential's SHAPE and the parse at its boundary — pure, so it is
// tested on node with no Keychain.
//
// It is PARSED, not trusted: the boundary is between bytes on a store an attacker
// with the user's unlocked phone could reach and a value the sync runtime puts in
// an `Authorization` header. A malformed record must read as "not paired" rather
// than as a credential the cloud refuses on every request forever. The pattern is
// the contract's own (`DEVICE_CREDENTIAL_PATTERN`), so a value this end stores is
// a value the cloud's bearer check admits.

import { DEVICE_CREDENTIAL_PATTERN } from "@repo/api/cloud/pairing/pairing-schema";
import { z } from "zod";

const storedCredentialSchema = z
  .object({
    deviceId: z.string().min(1),
    credential: z.string().regex(DEVICE_CREDENTIAL_PATTERN),
  })
  .strict();

export type DeviceCredential = z.infer<typeof storedCredentialSchema>;

/** The credential a raw stored string holds, or null when there is none to read
 *  — never paired, cleared since, or a record this build cannot reason about. */
export function parseStoredCredential(raw: string | null): DeviceCredential | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = storedCredentialSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export function serializeCredential(credential: DeviceCredential): string {
  return JSON.stringify(credential);
}
