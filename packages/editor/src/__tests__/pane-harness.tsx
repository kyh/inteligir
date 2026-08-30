// A mounted PANE for tests: this pane's open-note store around a Plate editor
// built from the shipped kit.
//
// A bare `<Plate>` is not a pane. The kit's own plugins read the pane they
// render in — heading collapse folds per note, the comment tint answers from
// the note's own sidecar — so a case that mounts one without a store asserts
// against a surface the app never draws.

import { useEffect } from "react";
import { Plate, PlateContent, usePlateEditor, type PlateEditor } from "platejs/react";
import type { Value } from "platejs";

import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { registerLiveEditor } from "@repo/editor/live-editor";
import { OpenNoteStoreProvider } from "@repo/editor/note/open-note-context";
import type { OpenNoteStore } from "@repo/editor/note/open-note-store";

/** Where a case that must drive the editor directly reads it from. */
export type EditorHolder = { editor: PlateEditor | null };

export function PaneHarness({
  value,
  store,
  holder,
  livePath,
}: {
  value: Value;
  store: OpenNoteStore;
  holder?: EditorHolder;
  /** The note this editor serves. Given, the pane registers it the way the
   * mounted rich editor does, so a non-React caller can find it by path. */
  livePath?: string;
}) {
  const editor = usePlateEditor({ plugins: EDITOR_KIT, value });
  if (holder !== undefined) holder.editor = editor;
  useEffect(() => {
    if (livePath === undefined) return;
    return registerLiveEditor(livePath, editor);
  }, [livePath, editor]);
  return (
    <OpenNoteStoreProvider store={store}>
      <Plate editor={editor}>
        <PlateContent />
      </Plate>
    </OpenNoteStoreProvider>
  );
}
