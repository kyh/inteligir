// ---------------------------------------------------------------------------
// Vault file identity — the atom of the sync protocol.
//
// @repo/notes is PURE: no node, no dom, no fs, no react. It runs unchanged in a
// Cloudflare Worker (the coordinator), React Native (the mobile client), and
// the desktop renderer. Keep it that way — nothing here may touch
// a filesystem, a clock, or crypto. Values (hashes, timestamps) are computed by
// the caller on their platform and passed in.
// ---------------------------------------------------------------------------

/**
 * Lowercase sha-256 hex digest (64 chars) of a file's raw bytes — a cheap,
 * collision-resistant content address used to detect changes and to break ties
 * deterministically.
 *
 * Kept a plain `string` alias rather than a nominal brand on purpose: branding
 * needs a checked cast (`value as Hash`), and this repo forbids `as`. Callers
 * hash with their platform crypto (Web Crypto / Node crypto) and pass the
 * digest in; @repo/notes never hashes. Validate untrusted input at a wire
 * boundary with `isValidHash` before trusting it.
 */
export type Hash = string;

const HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * True when `value` is a well-formed lowercase sha-256 hex digest. Use at a
 * transport boundary before trusting a hash that arrived over the network.
 */
export function isValidHash(value: string): boolean {
  return HASH_PATTERN.test(value);
}

/**
 * A vault-relative POSIX path, e.g. `"notes/todo.md"`. Always forward-slashed,
 * never absolute, no leading `"./"`. The vault root is implicit; a file's path
 * IS its identity (a rename is a delete of the old path + an add of the new).
 */
export type VaultPath = string;

/** Longest path any platform's write sink should honor — a generous bound that
 * still rejects a pathological unbounded manifest entry. */
const MAX_VAULT_PATH_LENGTH = 1024;

/** True if `value` contains a C0 control character or DEL — never legitimate in
 * a vault-relative path and a classic smuggling vector (NUL-truncation, CR/LF).
 * A codepoint scan rather than a regex: matching a control-char range in a
 * RegExp trips oxlint's no-control-regex, and this reads clearer anyway. */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * True when `value` is a well-formed vault-relative path safe to hand to a
 * platform write sink. Use at a transport boundary before trusting a path that
 * arrived over the network (or from a persisted manifest cache) — it is the
 * ENFORCEMENT of the `VaultPath` contract, not merely its documentation.
 *
 * Rejects the traversal / escape vectors a confined vault must never resolve:
 * an absolute path (leading `/`), any `..` or `.` segment, an empty segment
 * (leading/trailing/double slash), a Windows separator or drive letter, a NUL
 * or other control character, and an over-length string. A rejected path nulls
 * the whole manifest at `parseVaultFile` (all-or-nothing, the existing
 * contract), so no confined write sink ever sees a path that escapes the root.
 */
export function isValidVaultPath(value: string): boolean {
  if (value === "" || value.length > MAX_VAULT_PATH_LENGTH) return false;
  if (value.startsWith("/")) return false; // absolute
  if (value.includes("\\")) return false; // Windows separator / UNC
  if (/^[A-Za-z]:/.test(value)) return false; // drive letter (C:...)
  if (hasControlChar(value)) return false; // NUL, C0 controls, DEL
  for (const segment of value.split("/")) {
    if (segment === "" || segment === "." || segment === "..") return false;
  }
  return true;
}

/** One file in a vault as the coordinator sees it. */
export type VaultFile = {
  /** Vault-relative POSIX path — the file's identity. */
  readonly path: VaultPath;
  /**
   * sha-256 of the file's raw bytes (UTF-8 for markdown, opaque bytes for
   * images/pdfs). Changes iff the content changes.
   */
  readonly contentHash: Hash;
  /**
   * Monotonic per-file counter the coordinator assigns on every accepted write
   * (first write = 1). It is the optimistic-concurrency token: a writer submits
   * the version it last saw and the coordinator rejects the write if the file
   * has since moved on. `ABSENT_VERSION` (0) denotes "no such version yet" — the
   * file is absent.
   */
  readonly version: number;
  /** File size in bytes. Advisory (UI, quotas) — not part of identity. */
  readonly size: number;
};

/**
 * The version sentinel meaning "this file does not exist on the coordinator". A
 * create submits it as its expected-base-version (`putFile(..., ABSENT_VERSION)`
 * succeeds only if the path is currently empty).
 */
export const ABSENT_VERSION = 0;
