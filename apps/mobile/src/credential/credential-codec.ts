// The parse at the credential's at-rest boundary — pure, so it is tested on
// node with no Keychain. The SHAPE is the contract's own
// (`deviceCredentialSchema`): the boundary sits between bytes on a store an
// attacker with the user's unlocked phone could reach and a value the sync
// runtime puts in an `Authorization` header, and a malformed record must read
// as "not paired" rather than as a credential the cloud refuses on every
// request forever.

import {
  deviceCredentialSchema,
  type DeviceCredential,
} from "@repo/api/cloud/pairing/pairing-schema";

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
  const result = deviceCredentialSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export function serializeCredential(credential: DeviceCredential): string {
  return JSON.stringify(credential);
}
