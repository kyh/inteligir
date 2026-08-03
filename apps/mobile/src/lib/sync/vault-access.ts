// ---------------------------------------------------------------------------
// UI-facing access to the LOCAL vault (what a sync pass has already landed on
// disk). Reuses the same `SyncIo` the engine reconciles through, so the screens
// never touch Expo's File API directly and see exactly the files sync manages.
// ---------------------------------------------------------------------------

import type { VaultPath } from "@repo/notes/sync/vault-file";

import { createExpoVaultFs } from "./expo-vault-fs";
import { createSyncIo, VaultListingIncompleteError, VaultRootMissingError } from "./sync-io";

const io = createSyncIo(createExpoVaultFs());
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Every vault-relative file path currently on disk (sorted). LENIENT on a
 * missing vault root — the screens tolerate "nothing there yet" as an empty
 * list, while the SYNC path sees the same condition as a hard error (the
 * empty-listing guard). Mirrors the desktop's list()-lenient /
 * listAllPaths()-strict split. */
export function listVaultFiles(): VaultPath[] {
  try {
    return [...io.list()];
  } catch (err) {
    // Both refusals are SYNC-safety errors; the UI stays lenient for either
    // (a lost root, an unreadable subtree) rather than showing an error screen.
    if (err instanceof VaultRootMissingError || err instanceof VaultListingIncompleteError) {
      return [];
    }
    throw err;
  }
}

/** Read a vault file as UTF-8 text. */
export function readVaultText(path: VaultPath): string {
  return decoder.decode(io.read(path));
}

/** Write UTF-8 text to a vault file, creating parent directories as needed. */
export function writeVaultText(path: VaultPath, text: string): void {
  io.write(path, encoder.encode(text));
}
