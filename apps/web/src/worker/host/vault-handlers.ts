// ---------------------------------------------------------------------------
// The vault's Bridge handlers, over the Durable Object's own vault.
// ---------------------------------------------------------------------------

import type { DeleteVaultEntryResult, ReadVaultAssetResult } from "@repo/bridge/ipc-registry";
import { toErrorMessage } from "@repo/bridge/wire-helpers";

import type { HandlerRegistrar } from "./handler-registry";
import type { UserKnowledge } from "./knowledge/user-knowledge";
import { base64ToBytes, bytesToBase64 } from "./vault/base64";
import { VAULT_ROOT, type UserVault } from "./vault/user-vault";
import { renameWithLinkRewrite } from "./vault/vault-rename";

/**
 * Largest asset the inline `writeVaultAsset` channel accepts.
 *
 * The channel carries bytes as base64 inside ONE WebSocket frame. A Durable
 * Object caps a received message at 32 MiB and base64 inflates by a third, so
 * the frame is a hard ceiling rather than a budget — and a multi-megabyte frame
 * blocks every other message on that socket while it arrives. Anything past
 * this goes to the streaming upload route (./asset-route), which never puts the
 * bytes on the socket at all.
 */
const MAX_INLINE_ASSET_UPLOAD_BYTES = 4 * 1024 * 1024;

export function registerVaultHandlers(
  handle: HandlerRegistrar,
  vault: UserVault,
  knowledge: UserKnowledge,
): void {
  handle("getVaultRoot", () => VAULT_ROOT);
  handle("listVault", () => vault.list());
  handle("readVaultDoc", ({ path }) => vault.readText(path));
  handle("getVaultFileFacts", ({ path }) => vault.fileFacts(path));

  handle("writeVaultDoc", async ({ path, content }) => {
    // Unconditional (last write wins), exactly as the editor's autosave has
    // always been. The version the manifest carries is for the callers that
    // need compare-and-swap — the rename's link rewrite — not for this one.
    const result = await vault.writeText(path, content);
    // Unconditional, so the only refusal left is a path that does not name a
    // file inside the vault.
    if (!result.ok) throw new Error(`Path escapes the vault: ${path}`);
  });

  // Every user-initiated delete lands here. It is a TOMBSTONE, not a removal:
  // the file keeps its bytes for the retention window and the host's alarm
  // purges it. The gate holding is its OWN outcome, never `absent` and never a
  // throw — the file is still there, and the caller has to be able to say so.
  handle("deleteVaultEntry", async ({ path }): Promise<DeleteVaultEntryResult> => {
    const result = await vault.trash([path]);
    if (!result.ok) return { outcome: "held", held: result.held };
    return { outcome: result.trashed.length > 0 ? "trashed" : "absent" };
  });

  handle("renameVaultEntry", ({ from, to }) => renameWithLinkRewrite(vault, knowledge, from, to));

  handle("writeVaultAsset", async ({ dir, baseName, bytesBase64 }) => {
    const bytes = base64ToBytes(bytesBase64);
    if (bytes === null) throw new Error("Attachment bytes are not valid base64");
    if (bytes.length > MAX_INLINE_ASSET_UPLOAD_BYTES) {
      throw new Error(
        `Attachment too large for the socket (${bytes.length} bytes) — upload it over /v1/host/:userId/assets`,
      );
    }
    return { path: await vault.writeAsset(dir, baseName, bytes) };
  });

  handle("readVaultAsset", async ({ path }): Promise<ReadVaultAssetResult> => {
    try {
      const result = await vault.readInlineBytes(path);
      return result.ok ? { ok: true, bytesBase64: bytesToBase64(result.bytes) } : result;
    } catch (error) {
      return { ok: false, error: toErrorMessage(error) };
    }
  });

  // There is no snapshot to rebuild and no disk to re-crawl — the manifest was
  // never stale. Re-announcing keeps the "Refresh vault" command honest: every
  // pane re-queries and lands on exactly what the vault holds.
  handle("refreshVault", () => {
    vault.refresh();
  });
}
