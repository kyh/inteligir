import type { VaultIgnore } from "@repo/notes/knowledge/vault-ignore";
import { loadVaultIgnore } from "../vault/vault-ignore-files";

// read again on every listing, so a suite's own .gitignore edits land with no reload to drive
export const ignoreFromDisk = (root: string) => async (): Promise<VaultIgnore> =>
  await loadVaultIgnore(root, { ignoreCase: false });
