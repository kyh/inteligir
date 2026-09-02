import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { errnoCode } from "./errno";

const MARKER_FILE_NAME = "checkout-path";

// the instance id is a truncated hash, so two colliding checkouts would silently share
// one sqlite file; the marker turns that into a refusal.
export function ensureDevDataDirOwnership(dataDir: string, checkoutPath: string): void {
  mkdirSync(dataDir, { recursive: true });
  const markerPath = join(dataDir, MARKER_FILE_NAME);

  let existing: string;
  try {
    existing = readFileSync(markerPath, "utf8");
  } catch (error) {
    if (errnoCode(error) !== "ENOENT") {
      throw error;
    }
    writeFileSync(markerPath, `${checkoutPath}\n`, "utf8");
    return;
  }

  const recordedCheckout = existing.trim();
  if (recordedCheckout !== checkoutPath) {
    throw new Error(
      `Refusing to open dev data dir ${dataDir}: it belongs to checkout ` +
        `"${recordedCheckout}", but this process runs from "${checkoutPath}". ` +
        `Delete that directory if the old checkout is gone, or set ` +
        `INTELIGIR_DATA_DIR to give this checkout its own data dir.`,
    );
  }
}
