// What the shell tells the page before the page opens the library (src-tauri/src/cloud.rs and
// credential.rs): where the cloud is, where the shell serves the library's files, this build and
// this Mac's name, and the credential a sign-in kept, which the page holds in memory alone.

import { DEVICE_CREDENTIAL_PATTERN } from "@repo/contract/cloud/device/device-schema";
import { z } from "zod";

export const shellConfigSchema = z.strictObject({
  cloudOrigin: z.url(),
  deviceName: z.string().min(1),
  // the shell's own scheme, before a file's sha (src-tauri/src/file_scheme.rs)
  filesOrigin: z.string().min(1),
  version: z.string().min(1),
});
export type ShellConfig = z.infer<typeof shellConfigSchema>;

// the sign-in's whole answer, kept in the Keychain: the credential, its device and its account
export const keptCredentialSchema = z.strictObject({
  credential: z.string().regex(DEVICE_CREDENTIAL_PATTERN),
  deviceId: z.string().min(1),
  email: z.string().min(1),
  userId: z.string().min(1),
});
export type KeptCredential = z.infer<typeof keptCredentialSchema>;
