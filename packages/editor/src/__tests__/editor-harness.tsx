// a bare <Plate> is not the editor the app draws: the kit's plugins read the store
// they render under, so a case mounting one without a store asserts against a
// surface the app never draws.

import { useEffect, useImperativeHandle, type Ref } from "react";
import { Plate, PlateContent, usePlateEditor, type PlateEditor } from "platejs/react";
import type { Value } from "platejs";

import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { registerLiveEditor } from "@repo/editor/live-editor";
import { OpenNoteStoreProvider } from "@repo/editor/note/open-note-context";
import type { OpenNoteStore } from "@repo/editor/note/open-note-store";

export function EditorHarness({
  value,
  store,
  ref,
  livePath,
}: {
  value: Value;
  store: OpenNoteStore;
  ref?: Ref<PlateEditor>;
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
