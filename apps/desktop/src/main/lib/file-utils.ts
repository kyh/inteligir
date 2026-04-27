import { createHash } from "node:crypto";
import fs from "node:fs";

/**
 * True when both paths point to byte-identical files. Short-circuits via
 * size + mtime so warm restarts skip the sha256 read for unchanged files —
 * we always write dest from src, so dest.mtime ≥ src.mtime is sufficient
 * when sizes match. A reinstall with a new src bumps src.mtime above dest's
 * and falls through to the hash check.
 */
export function filesAreIdentical(srcPath: string, destPath: string): boolean {
  if (!fs.existsSync(destPath)) return false;
  try {
    const srcStat = fs.statSync(srcPath);
    const destStat = fs.statSync(destPath);
    if (srcStat.size !== destStat.size) return false;
    if (destStat.mtimeMs >= srcStat.mtimeMs) return true;
    return hashFile(srcPath) === hashFile(destPath);
  } catch {
    return false;
  }
}

function hashFile(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
