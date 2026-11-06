// The open note's editor state, as the open note's store publishes it to the kits that read it: a
// note open with its bytes and whether they are unsaved, or none. An item opened by id publishes
// none (its session says its own state).

type SaveError =
  | { readonly kind: "vanished" }
  | { readonly kind: "refused"; readonly message: string };

export interface OpenEditorState {
  readonly kind: "open";
  readonly path: string;
  readonly content: string;
  readonly dirty: boolean;
  // the last write's failure, held until a write lands or the buffer is replaced; `dirty` stays set under it.
  readonly saveError: SaveError | null;
  // moves when bytes from the IO rather than an edit replace the buffer: a surface re-seeds from
  // them and its next keystroke saves them, so they are gated before it does, dirty or not.
  readonly diskSeq: number;
}

export type VaultEditorState = { readonly kind: "closed" } | OpenEditorState;

export const EMPTY_EDITOR_STATE: VaultEditorState = { kind: "closed" };
