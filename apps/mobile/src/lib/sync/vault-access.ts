// ---------------------------------------------------------------------------
// UI-facing access to the LOCAL vault (what a sync pass has already landed on
// disk). Reuses the same `SyncIo` the engine reconciles through, so the screens
// never touch Expo's File API directly and see exactly the files sync manages.
// ---------------------------------------------------------------------------

import type { VaultPath } from "@repo/notes/sync/vault-file";

import { createExpoVaultFs } from "./expo-vault-fs";
import { createSyncIo, VaultListingIncompleteError, VaultRootMissingError } from "./sync-io";

const fs = createExpoVaultFs();
const io = createSyncIo(fs);
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

/** Read a vault file as UTF-8 text, or null when it is missing or unreadable.
 * Absence is a normal state for every caller here — quick capture seeds from a
 * template, the note editor treats it as "not on this device yet" — so the
 * missing case is a value, not a throw. Pair with `vaultFileExists` where the
 * two failures mean different things. */
export function readVaultTextOrNull(path: VaultPath): string | null {
  try {
    return decoder.decode(io.read(path));
  } catch {
    return null;
  }
}

/** Whether a vault file is on disk, whatever its bytes. */
export function vaultFileExists(path: VaultPath): boolean {
  try {
    return fs.exists(path);
  } catch {
    return false;
  }
}

/** Write UTF-8 text to a vault file, creating parent directories as needed. */
export function writeVaultText(path: VaultPath, text: string): void {
  io.write(path, encoder.encode(text));
}
