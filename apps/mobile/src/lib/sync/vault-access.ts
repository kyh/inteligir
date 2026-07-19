// ---------------------------------------------------------------------------
// UI-facing access to the LOCAL vault (what a sync pass has already landed on
// disk). Reuses the same `SyncIo` the engine reconciles through, so the screens
// never touch Expo's File API directly and see exactly the files sync manages.
// ---------------------------------------------------------------------------

import type { VaultPath } from "@repo/domain/sync/vault-file";

import { createExpoVaultFs } from "./expo-vault-fs";
import { createSyncIo } from "./sync-io";

const io = createSyncIo(createExpoVaultFs());
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Every vault-relative file path currently on disk (sorted). */
export function listVaultFiles(): VaultPath[] {
  return [...io.list()];
}

/** Read a vault file as UTF-8 text. */
export function readVaultText(path: VaultPath): string {
  return decoder.decode(io.read(path));
}

/** Write UTF-8 text to a vault file, creating parent directories as needed. */
export function writeVaultText(path: VaultPath, text: string): void {
  io.write(path, encoder.encode(text));
}
