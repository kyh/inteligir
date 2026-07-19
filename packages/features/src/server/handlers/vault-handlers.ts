import { remapNoteMetadata } from "../boot/rename-orchestration";
import { renameWithLinkRewrite } from "../knowledge/rename-rewrite";
import { probeVaultPrivacy } from "../boot/agent-wiring";
import { getPlatform } from "../platform-instance";
import { getVaultManager } from "../vault/vault";
import type { HandlerRegistrar } from "./handler-registry";
import { checkNoteName, noteNameErrorMessage } from "@repo/core/knowledge/note-name";
import { basenamePath } from "@repo/core/knowledge/vault-path";
import { toErrorMessage } from "@repo/features/wire-helpers";
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
    if (chosen === null) return { ok: false, reason: "canceled" };
    try {
      // setRoot rejects a folder inside ~/.inteligir (wiped on logout).
      getVaultManager().setRoot(chosen);
    } catch (err) {
      return { ok: false, reason: "error", error: toErrorMessage(err) };
    }
    return { ok: true, root: getVaultManager().getRoot() };
  });

  handle("listVault", () => getVaultManager().list());
  handle("readVaultDoc", ({ path }) => getVaultManager().readText(path));
  handle("writeVaultDoc", ({ path, content }) => {
    const vault = getVaultManager();
    vault.writeText(path, content);
    // This is the editor's write path (autosave). Mark it a self-save so the
    // open-note watcher filters the event it triggers rather than reloading the
    // editor onto what it just saved (vault liveness — CLAUDE.md § Decisions).
    // Restore / sync-pull do NOT go through here, so their writes still
    // surface as reloads.
    vault.markSelfSave(path);
  });
  // LIVE-disk privacy probe — the SAME fail-closed probe the agent tool gate
  // runs, so the renderer's context-hint check can never drift from it. The
  // buffer the renderer holds may be stale (an external sync/agent write can
  // flip `private: true` on disk first); only the host sees the disk truth.
  handle("probeNotePrivacy", ({ path }) => probeVaultPrivacy(path));
  // The renderer names the open note; the host watches that single file
  // (vault liveness — CLAUDE.md § Decisions).
  handle("setWatchedNote", ({ path }) => {
    getVaultManager().watchOpenNote(path);
  });
  // On-demand snapshot rebuild (window focus / "Refresh vault" command).
  handle("refreshVault", () => {
    getVaultManager().refresh();
  });
  // Every user-initiated delete (sidebar, header, HTML-app broker remove,
  // sync conflict-dismiss) lands here → OS trash, recoverable. Sync-applied
  // remote deletes bypass this channel and stay permanent (vault.delete).
  handle("deleteVaultEntry", async ({ path }) => ({
    removed: await getVaultManager().trash(path),
  }));
  handle("renameVaultEntry", ({ from, to }) => {
    // Boundary enforcement of the note-name ruleset (the renderer validates
    // too, for instant feedback — this is the layer nothing can skip). Only
    // the destination BASENAME is checked; directory moves pass through.
    // writeVaultDoc is deliberately NOT gated: it's the autosave path, and a
    // pre-existing file with a hostile name must keep saving.
    const verdict = checkNoteName(basenamePath(to));
    if (!verdict.ok) return { ok: false, error: noteNameErrorMessage(verdict.reason) };
    // Rename, then rewrite [[wiki]] / relative md links vault-wide so nothing
    // dangles (snapshot-verified byte surgery — see knowledge/rename-rewrite).
    const result = renameWithLinkRewrite(getVaultManager(), from, to);
    // Repoint delegations + AI-write checkpoints at the new path — the single
    // shared remap the agent's rename_note tool uses too, so the two rename
    // paths can't drift.
    if (result.ok) remapNoteMetadata(from, to);
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
