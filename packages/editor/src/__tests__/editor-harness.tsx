// a bare <Plate> is not the editor the app draws: the kit's plugins read the store
// they render under, so a case mounting one without a store asserts against a
// surface the app never draws.

import { useEffect, useImperativeHandle } from "react";
import type { Ref } from "react";
import { Plate, PlateContent, usePlateEditor } from "platejs/react";
import type { PlateEditor } from "platejs/react";
import type { Value } from "platejs";

import type { EditorProfile } from "@repo/editor/editor-profile";
import { registerLiveEditor } from "@repo/editor/live-editor";
import { PROFILE_KITS } from "@repo/editor/markdown-editor";
import { OpenNoteStoreProvider } from "@repo/editor/note/open-note-context";
import type { OpenNoteStore } from "@repo/editor/note/open-note-store";

export const EditorHarness = ({
  value,
  store,
  ref,
  livePath,
  nodeIds = false,
  profile = "desktop",
}: {
  value: Value;
  store: OpenNoteStore;
  ref?: Ref<PlateEditor>;
  livePath?: string;
  // Plate turns NodeIdPlugin off under NODE_ENV=test; the app runs it, and the block overlays
  // address blocks by that id.
  nodeIds?: boolean;
  // the kit the app mounts for that hand
  profile?: EditorProfile;
}) => {
  const editor = usePlateEditor({ nodeId: nodeIds, plugins: PROFILE_KITS[profile], value });
  useImperativeHandle(ref, () => editor, [editor]);
  useEffect(() => {
    if (livePath === undefined) {
      return;
    }
    return registerLiveEditor(livePath, editor);
  }, [livePath, editor]);
  return (
    <OpenNoteStoreProvider store={store}>
      <Plate editor={editor}>
        <PlateContent />
      </Plate>
    </OpenNoteStoreProvider>
  );
};
