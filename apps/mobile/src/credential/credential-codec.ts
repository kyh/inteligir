import { deviceCredentialSchema } from "@repo/contract/cloud/device/device-schema";
import { z } from "zod";

// what the Keychain keeps of a sign-in: the device's bearer and its id, and whose library it opens,
// which the account screen names
export const keptCredentialSchema = deviceCredentialSchema.extend({ email: z.string().min(1) });
export type KeptCredential = z.infer<typeof keptCredentialSchema>;

// a malformed record reads as "signed out", not as a credential the cloud refuses on every request.
export const parseStoredCredential = (raw: string | null): KeptCredential | null => {
  if (raw === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = keptCredentialSchema.safeParse(parsed);
  return result.success ? result.data : null;
};

export const serializeCredential = (credential: KeptCredential): string =>
  JSON.stringify(credential);
