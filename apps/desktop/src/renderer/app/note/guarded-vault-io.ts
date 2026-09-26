import type { GuardedVaultPort, GuardedWrite } from "@repo/editor/guarded-vault-io";
import { contentHashHex } from "@repo/api/local/vault/vault-schema";
import type { VaultWriteGuard } from "@repo/api/local/vault/vault-schema";
import { isDefinedError, safe } from "../api";
import type { client } from "../api";

export interface GuardedVaultApi {
  vault: Pick<(typeof client)["vault"], "read" | "write" | "remove">;
}

const wireGuard = async (guard: GuardedWrite): Promise<VaultWriteGuard> =>
  guard.kind === "absent"
    ? { kind: "absent" }
    : { hash: await contentHashHex(guard.base), kind: "expected" };

export const createGuardedVaultPort = (api: GuardedVaultApi): GuardedVaultPort => ({
  read: async (path) => {
    const { content } = await api.vault.read({ path });
    return content;
  },
  remove: async (path) => {
    const { error } = await safe(api.vault.remove({ path }));
    if (error !== null && !(isDefinedError(error) && error.code === "NOT_FOUND")) {
      throw error;
    }
  },
  write: async (path, content, guard) => {
    const { error } = await safe(api.vault.write({ content, guard: await wireGuard(guard), path }));
    if (error === null) {
      return { kind: "written" };
    }
    if (isDefinedError(error) && error.code === "ALREADY_EXISTS") {
      return { kind: "exists" };
    }
    if (isDefinedError(error) && error.code === "CAS_MISMATCH") {
      return error.data.current === undefined
        ? { kind: "missing" }
        : { current: error.data.current.content, kind: "changed" };
    }
    throw error;
  },
});
