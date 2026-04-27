import { createHash } from "node:crypto";
import fs from "node:fs";

export function hashFile(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/**
 * True when both paths point to byte-identical files. Hash-only — no mtime
 * shortcut, since dest may be mutated after copy (e.g. codesign on macOS) or
 * preserved across upgrades in ways that make mtime an unreliable signal.
 */
export function filesAreIdentical(srcPath: string, destPath: string): boolean {
  if (!fs.existsSync(destPath)) return false;
  try {
    return hashFile(srcPath) === hashFile(destPath);
  } catch {
    return false;
  }
}
