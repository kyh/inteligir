// ---------------------------------------------------------------------------
// pi path-resolution PARITY — SECURITY-CRITICAL.
//
// pi's file tools do NOT open the literal `path` argument. They first run
// expandPath (dist/core/tools/path-utils.js: strip a leading `@`, map unicode
// spaces — NBSP/en/em/… — to ASCII space, expand `~`), and `read` additionally
// retries filesystem-fallback variants (AM/PM narrow no-break space, NFD,
// curly quote) until one exists. A gate that resolves the RAW string probes a
// DIFFERENT file than the tool reads: `read({path:"@vault/secret.md"})`
// classified "outside the vault" (no probe) while pi stripped the `@` and read
// the private note through ./vault — a confirmed full-content bypass, with
// NBSP/`~`/NFD variants as siblings of the same root cause.
//
// pi does not export path-utils (package exports are "." and "./hooks" only),
// so this module REPLICATES it line-for-line. The replication is pinned by
// __tests__/pi-path-parity.test.ts, which imports pi's REAL path-utils.js from
// the installed package and asserts both resolvers agree on a battery of
// adversarial inputs — a pi upgrade that changes normalization fails that test
// loudly instead of silently reopening the bypass. Touch this file only in
// lockstep with that test.
//
// One deliberate deviation: pi applies the fs-fallback variants only in `read`
// (resolveReadPath); edit/write/ls/find/grep use resolveToCwd (expand+resolve,
// no variants). The gate uses the read-shaped resolver for EVERY file tool —
// a variant only ever redirects to a file that exists, so for edit/write this
// is strictly more conservative (pi would ENOENT/create the literal; the gate
// may additionally block when the on-disk variant is private). Fail-closed.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// pi's UNICODE_SPACES: U+00A0, U+2000–U+200A, U+202F, U+205F, U+3000.
// Literal characters, byte-for-byte the class pi's source uses.
const UNICODE_SPACES = /[  -   　]/g;
const NARROW_NO_BREAK_SPACE = " ";

function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** pi's expandPath: `@`-prefix strip → unicode-space normalization → `~`
 * expansion. Exported for the parity test only; the gate goes through
 * resolvePiToolPath. */
export function expandPiPath(filePath: string): string {
  const stripped = filePath.startsWith("@") ? filePath.slice(1) : filePath;
  const normalized = stripped.replace(UNICODE_SPACES, " ");
  if (normalized === "~") return os.homedir();
  if (normalized.startsWith("~/")) return os.homedir() + normalized.slice(1);
  return normalized;
}

/** pi's resolveReadPath: expand, resolve against cwd, then — when the literal
 * doesn't exist — retry the macOS AM/PM, NFD, curly-quote, and NFD+curly
 * filename variants and return whichever exists. This is the absolute target
 * pi's read tool will actually open; the gate classifies THIS, never the raw
 * input. (The `!== resolved` guards mirror pi exactly, quirks included.) */
export function resolvePiToolPath(filePath: string, cwd: string): string {
  const expanded = expandPiPath(filePath);
  const resolved = path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);
  if (fileExists(resolved)) return resolved;
  const amPmVariant = resolved.replace(/ (AM|PM)\./gi, `${NARROW_NO_BREAK_SPACE}$1.`);
  if (amPmVariant !== resolved && fileExists(amPmVariant)) return amPmVariant;
  const nfdVariant = resolved.normalize("NFD");
  if (nfdVariant !== resolved && fileExists(nfdVariant)) return nfdVariant;
  const curlyVariant = resolved.replace(/'/g, "’");
  if (curlyVariant !== resolved && fileExists(curlyVariant)) return curlyVariant;
  const nfdCurlyVariant = nfdVariant.replace(/'/g, "’");
  if (nfdCurlyVariant !== resolved && fileExists(nfdCurlyVariant)) return nfdCurlyVariant;
  return resolved;
}
