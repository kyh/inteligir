// ---------------------------------------------------------------------------
// The vault's wire vocabulary — the user's folder of markdown, as the channels
// that read and mutate it describe it. Paths are always vault-relative; the
// host confines them under the vault root.
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";

/** A vault-relative path to ONE markdown note — the unit the knowledge queries
 * are asked about. The prose that tells a model what a valid path looks like
 * lives HERE, once, instead of being restated per agent tool. */
export const NotePathSchema = Type.Object(
  {
    path: Type.String({
      description:
        "Path to a markdown note, relative to the vault root — e.g. 'notes/ideas.md'. " +
        "Never absolute, never escaping the vault.",
    }),
  },
  { additionalProperties: false },
);

/** A vault-relative path to ONE file of any kind — a note, an image, an HTML
 * app. Deliberately not `NotePathSchema`: these channels read/stat/trash
 * whatever the path names, so promising a model (or a reader) "a note" would
 * be a narrower contract than the handler behind it. */
export const VaultPathSchema = Type.Object(
  {
    path: Type.String({
      description:
        "Path to a single file — note or attachment — relative to the vault root, " +
        "e.g. 'assets/diagram.png'. Names a file, never a folder.",
    }),
  },
  { additionalProperties: false },
);

export const VaultWriteFileSchema = Type.Object(
  { path: Type.String(), content: Type.String() },
  { additionalProperties: false },
);

export const VaultRenameSchema = Type.Object(
  { from: Type.String(), to: Type.String() },
  { additionalProperties: false },
);

// Attachment ingestion — image (or other) bytes written into the vault, as
// base64 inside one socket frame.
export const VaultWriteAssetSchema = Type.Object(
  { dir: Type.String(), baseName: Type.String(), bytesBase64: Type.String() },
  { additionalProperties: false },
);

/**
 * Largest attachment `writeVaultAsset` carries.
 *
 * The channel puts the bytes as base64 inside ONE WebSocket frame: a Durable
 * Object caps a received message at 32 MiB, base64 inflates by a third, and a
 * multi-megabyte frame blocks every other message on that socket while it
 * arrives — so the frame stops being a plausible way to move a file well before
 * a user stops trying to paste one. Anything past this rides the streaming
 * upload transport instead (`installAssetUpload` in ./client), which never puts
 * the bytes on the socket at all.
 *
 * The number lives HERE because both ends read it: the host refuses a bigger
 * frame, and a client that picks its transport by the same number can never
 * compose one.
 */
export const MAX_INLINE_ASSET_BYTES = 4 * 1024 * 1024;

/** One file in the vault, relative to the vault root. `kind` splits editable
 * docs (see DOC_EXTENSIONS) from everything else (images, pdfs, …). */
export type VaultEntry = {
  path: string;
  name: string;
  kind: "doc" | "other";
};

/**
 * What one vault broadcast says moved.
 *
 * `changed` is `null` when the host cannot say — a `refreshVault` re-announces
 * the manifest without diffing it, so every client re-reads. Every real
 * mutation names at least one path, which is what lets a client skip the work a
 * change it can already see did not cause: re-listing on every autosave is a
 * round trip per keystroke burst, on every open socket.
 */
export type VaultChangedEvent = {
  readonly root: string;
  readonly changed: {
    readonly upserted: readonly string[];
    readonly removed: readonly string[];
  } | null;
};

/** Whether a vault broadcast may have changed `path` — true whenever the host
 * could not say what moved, so a caller that re-reads on true is never stale. */
export function vaultChangeTouches(event: VaultChangedEvent, path: string): boolean {
  const { changed } = event;
  if (changed === null) return true;
  return changed.upserted.includes(path) || changed.removed.includes(path);
}

/**
 * Everything the workspace's first paint needs, in ONE call.
 *
 * The listing, the persisted ui state and the open note's bytes are three
 * questions with one answer — and asked separately they are three sequential
 * round trips between a signed-in page and the object that holds all three.
 * `openNote` is resolved HOST-side from ui-state's own open-note key, so the
 * client never has to learn which note it wants before it can ask for it, and
 * it is `null` when nothing is recorded or the file is gone.
 */
export type WorkspaceBoot = {
  readonly root: string;
  readonly entries: VaultEntry[];
  readonly uiState: Record<string, unknown>;
  readonly openNote: { readonly path: string; readonly content: string } | null;
};

/** The facts about ONE vault file that the listing deliberately does not carry.
 * `VaultEntry` comes from the manifest listing, so size and mtime are a
 * separate, per-file question — asked about the note a user is looking at,
 * never swept. `null` when the file cannot be described (missing, escaping the
 * vault). */
export type VaultFileFacts = { sizeBytes: number; modifiedMs: number };

/** readVaultAsset result: base64 bytes of an in-vault file, or an error (the
 * file is missing, escapes the vault, or exceeds the transfer cap). Rendering
 * a broken image is a UI state, not an exception — hence a Result, not a throw. */
export type ReadVaultAssetResult = { ok: true; bytesBase64: string } | { ok: false; error: string };

/** The deletion gate's refusal, in the terms it is stated in. Every field is a
 * number the host computed, because the gate's policy is the host's. */
export type HeldDeletions = {
  /** How many deletions this call would bring the window to. */
  readonly deletions: number;
  /** Files the vault holds right now, for "N of M" phrasing. */
  readonly liveCount: number;
  /** The count above which the gate holds. */
  readonly limit: number;
  /** How long the rolling window is. It is what makes the refusal actionable —
   * the count drains by itself, and this is how long that takes. */
  readonly windowMs: number;
  /** A few of the paths this call would remove. */
  readonly sample: readonly string[];
};

/**
 * What a delete did.
 *
 * THREE outcomes, not a boolean, because the gate holding is a third thing:
 * `absent` says the path named no live file, and answering a HELD delete with
 * it would report a file the user can still see as gone. A caller that shows a
 * row must be able to tell "it went", "it was never there" and "the host
 * refused, here is why" apart.
 */
export type DeleteVaultEntryResult =
  | { readonly outcome: "trashed" }
  | { readonly outcome: "absent" }
  | { readonly outcome: "held"; readonly held: HeldDeletions };

/**
 * The sentence a held deletion is reported with — one phrasing, so the refusal
 * reads the same in a toast, in an agent tool's failure and in a log.
 *
 * It names the recourse that EXISTS. No confirmation verb crosses the Bridge,
 * so a sentence ending "confirm to proceed" would send every reader — the user
 * and the model alike — looking for a button nobody can press. What actually
 * releases the hold is time: the count is a rolling window, and it drains.
 */
export function heldDeletionMessage(held: HeldDeletions): string {
  const named = held.sample.map((path) => `"${path}"`).join(", ");
  const more = held.sample.length < held.deletions ? ", …" : "";
  return (
    `Held: this would make ${held.deletions} deletions inside ` +
    `${Math.round(held.windowMs / 60_000)} minutes, past the limit of ` +
    `${Math.round(held.limit)} for a vault of ${held.liveCount} files. ` +
    `Nothing was deleted (${named}${more}). The count is a rolling window that drains on ` +
    `its own — wait for it to clear, then delete again.`
  );
}
