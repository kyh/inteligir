// The vault's route handlers, registered against the contract rows. Domain
// refusals (bad path, missing entry, overwrite) answer with their declared
// statuses here; anything unexpected falls through to the API's generic 500.

import { apiRoutes, type ApiErrorResponse } from "@repo/server-contract/routes";
import {
  VAULT_ASSET_MEDIA_TYPES,
  type VaultRenameResponse,
  type VaultWriteConflict,
} from "@repo/server-contract/vault";
import type { TypedRoutesRegistrars } from "@repo/typed-routes/typed-routes";
import { VaultPathError } from "./vault-paths";
import type { VaultRuntime } from "./vault-runtime";
import { VaultServiceError, type GuardedWriteGuard } from "./vault-service";

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

/** The media type this extension is served as, or null for anything outside
 *  the allowlist. Lowercased, because a vault carries `.PNG` too. */
function assetMediaType(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  return VAULT_ASSET_MEDIA_TYPES[path.slice(dot).toLowerCase()] ?? null;
}

// An asset is bytes from a vault a git remote can write into, served from the
// app's own origin. `nosniff` pins the declared type, and the sandbox CSP is
// what makes SVG safe: `<img>` never runs its script, but a NAVIGATION to this
// URL renders it as a document, and a sandbox with no `allow-scripts` refuses
// that. `no-cache` with an ETag: a re-mounted image revalidates in a round
// trip instead of re-downloading, and an edited asset is never stale.
const ASSET_HEADERS: Readonly<Record<string, string>> = {
  "cache-control": "no-cache",
  "content-security-policy": "default-src 'none'; sandbox",
  "x-content-type-options": "nosniff",
};

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

  get(apiRoutes.vault.asset, async (c, query) => {
    const mediaType = assetMediaType(query.path);
    if (mediaType === null) {
      return c.json(
        {
          error: "invalid_path",
          message: `${query.path} is not an image type this vault serves`,
        },
        400,
      );
    }
    try {
      const asset = await vault.service.readBytes(query.path);
      if (c.req.header("if-none-match") === asset.etag) {
        return c.body(null, 304, { ...ASSET_HEADERS, etag: asset.etag });
      }
      return c.body(asset.bytes, 200, {
        ...ASSET_HEADERS,
        "content-type": mediaType,
        etag: asset.etag,
      });
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
      if (body.expectedHash === undefined && body.ifAbsent === undefined) {
        return c.json(await vault.service.write(body.path, body.content));
      }
      const guard: GuardedWriteGuard =
        body.expectedHash === undefined ? { ifAbsent: true } : { expectedHash: body.expectedHash };
      const result = await vault.service.writeGuarded(body.path, body.content, guard);
      if (result.applied) {
        return c.json({ path: result.path });
      }
      if (result.reason === "exists") {
        const refused: VaultWriteConflict = {
          error: "already_exists",
          message: `A file already exists at ${body.path}`,
        };
        return c.json(refused, 409);
      }
      const refused: VaultWriteConflict = {
        error: "cas_mismatch",
        message: `${body.path} changed since the base this write was derived from`,
        ...(result.current === null ? {} : { current: result.current }),
      };
      return c.json(refused, 409);
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

  post(apiRoutes.vault.mkdir, async (c, body) => {
    try {
      return c.json(await vault.service.createDir(body.path));
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
