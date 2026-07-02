// Which pane a piece of editor UI lives in, and whether that pane is the
// active (visible) tab. Every open tab keeps its editor mounted (#369 —
// hidden with display:none so undo history, DOM, and transient AI state
// survive tab switches), which breaks the old "exactly one editor is
// mounted" assumption. Surfaces that used to lean on it consume this
// context instead:
//
// - portalled float UI (the AI menu) renders only in the active pane —
//   a portal escapes the pane's display:none, so it must self-gate;
// - module-level runner bridges (embed dialog opener) register only from
//   the active pane, so a background pane can't capture a global trigger;
// - inline comboboxes cancel when their pane deactivates (their popup is
//   portalled and their trigger element must not linger in a hidden doc);
// - per-note lookups (transclusion cycle roots, delegation source files)
//   read the PANE's path, not the active tab's.
//
// `null` means "not inside a tab pane" (tests, standalone mounts) — treat as
// an active pane serving the vault-context's open note.

import { createContext, useContext } from "react";

export type EditorPaneInfo = {
  /** Vault-relative path of the note this pane serves. */
  path: string;
  /** Whether this pane is the visible tab (false = mounted but hidden). */
  active: boolean;
};

export const EditorPaneContext = createContext<EditorPaneInfo | null>(null);

export function useEditorPane(): EditorPaneInfo | null {
  return useContext(EditorPaneContext);
}
