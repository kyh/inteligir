// A mounted PANE for tests: this pane's open-note store around a Plate editor
// built from the shipped kit.
//
// A bare `<Plate>` is not a pane. The kit's own plugins read the pane they
// render in — heading collapse folds per note, the comment tint answers from
// the note's own sidecar — so a case that mounts one without a store asserts
// against a surface the app never draws.

import { useEffect, useImperativeHandle, type Ref } from "react";
import { Plate, PlateContent, usePlateEditor, type PlateEditor } from "platejs/react";
import type { Value } from "platejs";

import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { registerLiveEditor } from "@repo/editor/live-editor";
import { OpenNoteStoreProvider } from "@repo/editor/note/open-note-context";
import type { OpenNoteStore } from "@repo/editor/note/open-note-store";

export function PaneHarness({
  value,
  store,
  ref,
  livePath,
}: {
  value: Value;
  store: OpenNoteStore;
  /** Where a case that must drive the editor directly reads it from — the
   * harness hands the editor out the way any component hands out a handle,
   * rather than writing into an object it was passed. */
  ref?: Ref<PlateEditor>;
  /** The note this editor serves. Given, the pane registers it the way the
   * mounted rich editor does, so a non-React caller can find it by path. */
  livePath?: string;
}) {
  const editor = usePlateEditor({ plugins: EDITOR_KIT, value });
  useImperativeHandle(ref, () => editor, [editor]);
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
