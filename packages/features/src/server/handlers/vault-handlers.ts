import { getDelegationManager } from "../delegation/delegation-manager";
import { renameWithLinkRewrite } from "../knowledge/rename-rewrite";
import { getPlatform } from "../platform-instance";
import { getVaultManager } from "../vault/vault";
import type { HandlerRegistrar } from "../lib/handler-registry";
import { toErrorMessage } from "@repo/features/ipc";
import type { ChooseVaultResult, ReadVaultAssetResult } from "@repo/features/ipc-registry";

// Largest asset the renderer may pull back as base64 for rendering. Base64
// inflates ~4/3, so a 10 MiB file crosses IPC as ~13 MiB of string — well
// within Electron's structured-clone limits, and past this an inline preview
// isn't the right affordance anyway.
const MAX_ASSET_BYTES = 10 * 1024 * 1024;

/** Reduce a caller-supplied file name to a safe leaf: no path separators, no
 * traversal, no leading dots (hidden files), only word/space/dot/dash chars.
 * Empty or fully-stripped input falls back to "image". */
export function sanitizeAssetName(raw: string): string {
  const leaf = raw.split(/[/\\]/).pop() ?? "";
  const cleaned = leaf
    .replaceAll(/[^\w .-]+/g, "")
    .replace(/^\.+/, "")
    .trim();
  return cleaned.length > 0 ? cleaned : "image";
}

/** Normalize a target directory to a clean vault-relative prefix (dropping
 * `.`/`..`/empty segments); empty input defaults to "assets". */
export function normalizeAssetDir(raw: string): string {
  const segments = raw
    .split(/[/\\]/)
    .filter((segment) => segment !== "" && segment !== "." && segment !== "..");
  return segments.length > 0 ? segments.join("/") : "assets";
}

/** Vault-relative path for a new asset: `<dir>/<name>`, suffixed `-1`, `-2`, …
 * before the extension until it doesn't collide with an `existing` path. */
export function pickAssetPath(dir: string, name: string, existing: ReadonlySet<string>): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let candidate = `${dir}/${name}`;
  for (let i = 1; existing.has(candidate); i++) {
    candidate = `${dir}/${stem}-${i}${ext}`;
  }
  return candidate;
}

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

  // ---- Attachments (image paste/drop) ---------------------------------------

  handle("writeVaultAsset", ({ dir, baseName, bytesBase64 }) => {
    const vault = getVaultManager();
    const existing = new Set(vault.list().map((entry) => entry.path));
    const path = pickAssetPath(normalizeAssetDir(dir), sanitizeAssetName(baseName), existing);
    vault.writeBytes(path, new Uint8Array(Buffer.from(bytesBase64, "base64")));
    return { path };
  });

  handle("readVaultAsset", ({ path }): ReadVaultAssetResult => {
    try {
      const bytes = getVaultManager().readBytes(path);
      if (bytes.length > MAX_ASSET_BYTES) {
        return { ok: false, error: `File too large to preview (${bytes.length} bytes)` };
      }
      return { ok: true, bytesBase64: Buffer.from(bytes).toString("base64") };
    } catch (err) {
      return { ok: false, error: toErrorMessage(err) };
    }
  });
}
