// ---------------------------------------------------------------------------
// Vault path identity — the one place a caller-supplied path becomes a file.
//
// CASE: this vault is CASE-PRESERVING BUT CASE-INSENSITIVE. `Note.md` and
// `note.md` are ONE file, spelled the way it was last written.
//
// The hazard inverts on the way to the cloud, which is why the decision has to
// be made here rather than inherited. A local vault sits on a case-insensitive
// filesystem (APFS, NTFS), where the danger is that two vault paths resolve to
// the SAME file and a delete of one destroys the other. R2 keys are
// case-SENSITIVE, so the danger is the mirror image: two spellings that were
// one file on the user's laptop become two live objects, each with its own
// manifest row, each shadowing the other's wiki links — and a guard written for
// the local hazard silently guards nothing, because the two keys never collide.
//
// So identity is the FOLDED path (NFC, lowercased) and the R2 key is derived
// from it. The second object is unrepresentable rather than merely unlikely.
//
// The consequence, stated: a user cannot keep `Note.md` and `note.md` side by
// side — writing one when the other exists overwrites it and adopts the newer
// spelling. In exchange a case-only rename is a pure retitle: the manifest's
// display path changes, the blob never moves, and no link can dangle. That
// matches every filesystem these files land on when exported, and matches the
// knowledge engine, whose wiki resolution has always been case-insensitive.
// ---------------------------------------------------------------------------

import { normalizePath } from "@repo/notes/knowledge/vault-path";

/** A vault path that has been proven to name a file inside the vault. */
export type VaultKey = {
  /** The spelling to store and show — NFC-normalized, `/`-separated, no `.`
   * or `..` segments. */
  readonly path: string;
  /** The identity: `path`, case-folded. Manifest primary key and R2 key
   * suffix, so one file can never become two objects. */
  readonly key: string;
};

/**
 * Parse a caller-supplied vault-relative path, or `null` when it does not name
 * a file inside the vault (empty, or climbing out through `..`).
 *
 * Confinement is LEXICAL and total, which is the whole story here: there are no
 * symlinks in an R2 bucket, so the desktop's second, symlink-resolving layer
 * has nothing to resolve. `normalizePath` keeps leading `..` segments precisely
 * so an escape is detectable rather than silently clamped to the root.
 */
export function parseVaultPath(raw: string): VaultKey | null {
  const path = normalizePath(raw).normalize("NFC");
  if (path === "" || path === ".." || path.startsWith("../")) return null;
  return { path, key: path.toLowerCase() };
}
