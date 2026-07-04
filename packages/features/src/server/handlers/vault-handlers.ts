import { getDelegationManager } from "../delegation/delegation-manager";
import { renameWithLinkRewrite } from "../knowledge/rename-rewrite";
import { getPlatform } from "../platform-instance";
import { getVaultManager } from "../vault/vault";
import type { HandlerRegistrar } from "../lib/handler-registry";
import { toErrorMessage } from "@repo/features/ipc";
import type { ChooseVaultResult } from "@repo/features/ipc-registry";

export function registerVaultHandlers(handle: HandlerRegistrar): void {
  // ---- Trusted surface (Vault panel) ----------------------------------------

  handle("getVaultRoot", () => getVaultManager().getRoot());

  handle("chooseVaultRoot", async (): Promise<ChooseVaultResult> => {
    const chosen = await getPlatform().pickDirectory({
      title: "Choose vault folder",
      defaultPath: getVaultManager().getRoot(),
    });
    if (chosen === null) return { canceled: true };
    try {
      // setRoot rejects a folder inside ~/.inteligir (wiped on logout).
      getVaultManager().setRoot(chosen);
    } catch (err) {
      return { error: toErrorMessage(err) };
    }
    return { root: getVaultManager().getRoot() };
  });

  handle("listVault", () => getVaultManager().list());
  handle("readVaultDoc", ({ path }) => getVaultManager().readText(path));
  handle("writeVaultDoc", ({ path, content }) => {
    getVaultManager().writeText(path, content);
  });
  handle("deleteVaultEntry", ({ path }) => ({ removed: getVaultManager().delete(path) }));
  handle("renameVaultEntry", ({ from, to }) => {
    // Rename, then rewrite [[wiki]] / relative md links vault-wide so nothing
    // dangles (snapshot-verified byte surgery — see knowledge/rename-rewrite).
    const result = renameWithLinkRewrite(getVaultManager(), from, to);
    // Repoint any delegations so badges keep matching and queued runs target the
    // new path (rename preserves content, so their positional anchors hold). The
    // disk rename is the source of truth — if this best-effort metadata remap
    // throws, log it but still report the rename that actually happened, rather
    // than tell the renderer it failed and leave the two views inconsistent.
    if (result.ok) {
      try {
        getDelegationManager().renameSource(from, to);
      } catch (err) {
        console.warn("[vault] delegation remap after rename failed:", err);
      }
    }
    return result;
  });
}
