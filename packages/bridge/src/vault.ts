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

// Attachment ingestion — image (or other) bytes written into the vault. A
// client reaches the host over the Bridge only, so bytes cross as base64 both
// ways.
export const VaultWriteAssetSchema = Type.Object(
  { dir: Type.String(), baseName: Type.String(), bytesBase64: Type.String() },
  { additionalProperties: false },
);

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

/** The deletion gate's refusal, in the terms a human is asked to confirm. */
export type HeldDeletions = {
  /** How many deletions this call would bring the window to. */
  readonly deletions: number;
  /** Files the vault holds right now, for "N of M" phrasing. */
  readonly liveCount: number;
  /** The count above which the gate holds. */
  readonly limit: number;
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

/** The sentence a held deletion is reported with — one phrasing, so the refusal
 * reads the same in a toast, in an agent tool's failure and in a log. */
export function heldDeletionMessage(held: HeldDeletions): string {
  const named = held.sample.map((path) => `"${path}"`).join(", ");
  return (
    `Refusing to delete ${held.deletions} file(s) of ${held.liveCount} without confirmation ` +
    `(${named}${held.sample.length < held.deletions ? ", …" : ""}). ` +
    "Confirm the deletion to proceed."
  );
}
