// The vault's route handlers, registered against the contract rows. Domain
// refusals (bad path, missing entry, overwrite) answer with their declared
// statuses here; anything unexpected falls through to the API's generic 500.

import { apiRoutes, type ApiErrorResponse } from "@repo/server-contract/routes";
import type { VaultRenameResponse } from "@repo/server-contract/vault";
import type { TypedRoutesRegistrars } from "@repo/typed-routes/typed-routes";
import { VaultPathError } from "./vault-paths";
import type { VaultRuntime } from "./vault-runtime";
import { VaultServiceError } from "./vault-service";

type VaultRefusal = "invalid_path" | "not_found" | "conflict" | "too_large";

function classifyVaultError(error: unknown): { code: VaultRefusal; body: ApiErrorResponse } | null {
  if (error instanceof VaultPathError) {
    return { code: "invalid_path", body: { error: "invalid_path", message: error.message } };
  }
  if (error instanceof VaultServiceError) {
    return { code: error.code, body: { error: error.code, message: error.message } };
  }
  return null;
}

/** The composed rename (link rewrite riding the service's rename); refusals
 *  surface as the same VaultPathError/VaultServiceError the service throws. */
export type RenameNote = (from: string, to: string) => Promise<VaultRenameResponse>;

export function registerVaultRoutes(
  registrars: Pick<TypedRoutesRegistrars, "get" | "post" | "put">,
  vault: VaultRuntime,
  renameNote: RenameNote,
): void {
  const { get, post, put } = registrars;

  get(apiRoutes.vault.tree, async (c) => c.json(await vault.service.listTree()));

  get(apiRoutes.vault.read, async (c, query) => {
    try {
      return c.json(await vault.service.read(query.path));
    } catch (error) {
      const refusal = classifyVaultError(error);
      if (refusal?.code === "invalid_path") {
        return c.json(refusal.body, 400);
      }
      if (refusal?.code === "not_found") {
        return c.json(refusal.body, 404);
      }
      if (refusal?.code === "too_large") {
        return c.json(refusal.body, 413);
      }
      throw error;
    }
  });

  put(apiRoutes.vault.write, async (c, body) => {
    try {
      return c.json(await vault.service.write(body.path, body.content));
    } catch (error) {
      const refusal = classifyVaultError(error);
      if (refusal?.code === "invalid_path") {
        return c.json(refusal.body, 400);
      }
      if (refusal?.code === "conflict") {
        return c.json(refusal.body, 409);
      }
      throw error;
    }
  });

  post(apiRoutes.vault.rename, async (c, body) => {
    try {
      return c.json(await renameNote(body.from, body.to));
    } catch (error) {
      const refusal = classifyVaultError(error);
      if (refusal?.code === "invalid_path") {
        return c.json(refusal.body, 400);
      }
      if (refusal?.code === "not_found") {
        return c.json(refusal.body, 404);
      }
      if (refusal?.code === "conflict") {
        return c.json(refusal.body, 409);
      }
      throw error;
    }
  });

  post(apiRoutes.vault.remove, async (c, body) => {
    try {
      await vault.service.remove(body.path);
      return c.json({ ok: true });
    } catch (error) {
      const refusal = classifyVaultError(error);
      if (refusal?.code === "invalid_path") {
        return c.json(refusal.body, 400);
      }
      if (refusal?.code === "not_found") {
        return c.json(refusal.body, 404);
      }
      throw error;
    }
  });

  get(apiRoutes.vault.status, async (c) => c.json(await vault.status()));

  post(apiRoutes.vault.syncNow, async (c) => c.json(await vault.syncNow()));
}
