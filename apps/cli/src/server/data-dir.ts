import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { errnoCode } from "./errno";

const MARKER_FILE_NAME = "checkout-path";

/**
 * A derived dev data dir belongs to exactly one checkout. The instance id is
 * a truncated hash, so two checkouts colliding on it would silently share one
 * SQLite file; the marker turns that into a refusal instead. First boot
 * records the checkout path; later boots must match it.
 */
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
