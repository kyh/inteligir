// ---------------------------------------------------------------------------
// The expo-backed `CaptureIo` — the ONLY impure edge of the capture path.
// Reuses vault-access's read/write (the same `SyncIo` the engine reconciles
// through), so a capture write is indistinguishable from any other local
// vault edit as far as sync is concerned. Kept out of daily-capture.ts so the
// pure module never drags expo-file-system into the node test environment.
// ---------------------------------------------------------------------------

import { readVaultText, writeVaultText } from "../sync/vault-access";
import type { CaptureIo } from "./daily-capture";

/** A `CaptureIo` over the local expo vault. `read` maps a missing file to
 * null (vault-access throws) — the seed-from-template path. */
export function createVaultCaptureIo(): CaptureIo {
  return {
    read: (path) => {
      try {
        return readVaultText(path);
      } catch {
        return null; // missing (or unreadable) — appendCapture seeds it
      }
    },
    write: (path, text) => {
      writeVaultText(path, text);
    },
  };
}
