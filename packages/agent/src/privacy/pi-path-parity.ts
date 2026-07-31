// ---------------------------------------------------------------------------
// pi path-resolution PARITY — SECURITY-CRITICAL.
//
// pi's file tools do NOT open the literal `path` argument. They first run
// expandPath (dist/core/tools/path-utils.js → dist/utils/paths.js
// normalizePath: map unicode spaces — NBSP/en/em/… — to ASCII space, strip a
// leading `@`, expand `~`, and convert `file://` URLs to filesystem paths),
// and `read` additionally retries filesystem-fallback
// variants (AM/PM narrow no-break space, NFD, curly quote) until one exists.
// A gate that resolves the RAW string probes a DIFFERENT file than the tool
// reads: `read({path:"@vault/secret.md"})` classified "outside the vault"
// (no probe) while pi stripped the `@` and read the private note through
// ./vault — a confirmed full-content bypass, with NBSP/`~`/NFD/`file://`
// variants as siblings of the same root cause.
//
// pi does not export path-utils (package exports are "." and "./rpc-entry"
// only), so this module REPLICATES it line-for-line (pi 0.82 semantics:
// unicode spaces → `@`-strip → `~` via join() → file:// URL →
// resolve()-normalized).
// The replication is pinned by __tests__/pi-path-parity.test.ts, which
// imports pi's REAL path-utils.js from the installed package and asserts
// both resolvers agree on a battery of adversarial inputs — a pi upgrade
// that changes normalization fails that test loudly instead of silently
// reopening the bypass. Touch this file only in lockstep with that test.
//
// Two deliberate deviations: (1) pi applies the fs-fallback variants only in
// `read` (resolveReadPath / its async twin resolveReadPathAsync — identical
// chains); edit/write/ls/find/grep use resolveToCwd (expand+resolve, no
// variants). The gate uses the read-shaped resolver for EVERY file tool — a
// variant only ever redirects to a file that exists, so for edit/write this
// is strictly more conservative (pi would ENOENT/create the literal; the
// gate may additionally block when the on-disk variant is private).
// (2) A malformed `file://` URL makes fileURLToPath THROW — in pi that
// errors the tool call; in the gate the throw propagates through the
// tool_call handler, which pi catches into a blocking error result.
// Fail-closed both ways.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// pi's UNICODE_SPACES — the exact class pi's source declares (escapes, not
// literals, so an editor/tool round-trip can never corrupt the class):
// U+00A0, U+2000-U+200A, U+202F, U+205F, U+3000.
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const NARROW_NO_BREAK_SPACE = "\u202F";

function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** pi 0.80's normalizePath `~` branch: `~` alone → home; `~/` (and `~\` on
 * win32) → join(home, rest). join() — not string concat — so `~//x` collapses
 * exactly as pi's does. */
function expandTilde(normalized: string): string | null {
  if (normalized === "~") return os.homedir();
  if (
    normalized.startsWith("~/") ||
    (process.platform === "win32" && normalized.startsWith("~\\"))
  ) {
    return path.join(os.homedir(), normalized.slice(2));
  }
  return null;
}

/** pi's expandPath — normalizePath with the tools' options, replicated in
 * pi's exact order: unicode-space normalization → `@`-prefix strip → `~`
 * expansion → `file://` URL conversion. Exported for the parity test only;
 * the gate goes through resolvePiToolPath. */
export function expandPiPath(filePath: string): string {
  let normalized = filePath.replace(UNICODE_SPACES, " ");
  if (normalized.startsWith("@")) normalized = normalized.slice(1);
  const tilde = expandTilde(normalized);
  if (tilde !== null) return tilde;
  // pi tests /^file:\/\// — an anchored literal, identical to startsWith.
  if (normalized.startsWith("file://")) return fileURLToPath(normalized);
  return normalized;
}

/** pi's normalizePath with DEFAULT options (what resolvePath applies to the
 * base dir): tilde + file:// only — no unicode-space or `@` handling. */
function normalizePiBaseDir(dir: string): string {
  const tilde = expandTilde(dir);
  if (tilde !== null) return tilde;
  if (dir.startsWith("file://")) return fileURLToPath(dir);
  return dir;
}

/** pi's resolveReadPath: expand, resolve against cwd (pi runs BOTH the
 * absolute and the relative branch through path.resolve, so `..`/`.`/double
 * separators normalize exactly as pi's do), then — when the literal doesn't
 * exist — retry the macOS AM/PM, NFD, curly-quote, and NFD+curly filename
 * variants and return whichever exists. This is the absolute target pi's
 * read tool will actually open; the gate classifies THIS, never the raw
 * input. (The `!== resolved` guards mirror pi exactly, quirks included.) */
export function resolvePiToolPath(filePath: string, cwd: string): string {
  const expanded = expandPiPath(filePath);
  const resolved = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(normalizePiBaseDir(cwd), expanded);
  if (fileExists(resolved)) return resolved;
  const amPmVariant = resolved.replace(/ (AM|PM)\./gi, `${NARROW_NO_BREAK_SPACE}$1.`);
  if (amPmVariant !== resolved && fileExists(amPmVariant)) return amPmVariant;
  const nfdVariant = resolved.normalize("NFD");
  if (nfdVariant !== resolved && fileExists(nfdVariant)) return nfdVariant;
  const curlyVariant = resolved.replace(/'/g, "\u2019");
  if (curlyVariant !== resolved && fileExists(curlyVariant)) return curlyVariant;
  const nfdCurlyVariant = nfdVariant.replace(/'/g, "\u2019");
  if (nfdCurlyVariant !== resolved && fileExists(nfdCurlyVariant)) return nfdCurlyVariant;
  return resolved;
}
