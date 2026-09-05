// The page names a vault entry; only main hands it to the OS, and only after the entry has
// proved it sits under the vault. Containment is physical, like the server's: both sides are
// realpathed first, so a symlink planted inside the vault cannot open what it points at.

import { join } from "node:path";

import { parseVaultPath } from "@repo/notes/knowledge/vault-path";
import { pathContains } from "inteligir/server/path-containment";

export type VaultEntryVerdict =
  | { readonly ok: true; readonly absPath: string }
  | { readonly ok: false; readonly reason: string };

export interface ResolveVaultEntryArgs {
  vaultDir: string;
  path: string;
  // node's realpathSync in production; a table in tests
  realpath: (candidate: string) => string;
}

export function resolveVaultEntry(args: ResolveVaultEntryArgs): VaultEntryVerdict {
  const parsed = parseVaultPath(args.path);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.message };
  }
  let rootReal: string;
  let entryReal: string;
  try {
    rootReal = args.realpath(args.vaultDir);
    entryReal = args.realpath(join(args.vaultDir, ...parsed.path.split("/")));
  } catch {
    return { ok: false, reason: `${parsed.path} is not in the vault` };
  }
  if (rootReal === entryReal || !pathContains(rootReal, entryReal)) {
    return { ok: false, reason: `${parsed.path} is not in the vault` };
  }
  return { ok: true, absPath: entryReal };
}
