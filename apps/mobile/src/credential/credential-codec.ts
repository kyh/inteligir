import {
  deviceCredentialSchema,
  type DeviceCredential,
} from "@repo/api/cloud/device/device-schema";

// a malformed record reads as "signed out", not as a credential the cloud refuses on every request.
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
