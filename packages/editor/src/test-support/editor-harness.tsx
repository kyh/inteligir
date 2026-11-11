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
import { PROFILE_KITS } from "@repo/editor/kits/profile-kits";
import { OpenItemProvider } from "@repo/editor/open-item";
import { EDITOR_CHUNK } from "@repo/editor/style-hooks";

export const EditorHarness = ({
  value,
  itemId = null,
  ref,
  nodeIds = false,
  profile = "desktop",
  chunkSize,
}: {
  value: Value;
  // the item the editor shows, as the item editor provides it and answers for it
  itemId?: string | null;
  ref?: Ref<PlateEditor>;
  // Plate turns NodeIdPlugin off under NODE_ENV=test; the app runs it, and the block overlays
  // address blocks by that id.
  nodeIds?: boolean;
  // the kit the app mounts for that hand
  profile?: EditorProfile;
  // the top level in runs of this many blocks, each a box as the app draws it
  chunkSize?: number;
}) => {
  const editor = usePlateEditor({
    // Plate's own default unless a size is asked for
    chunking: chunkSize === undefined ? true : { chunkSize, contentVisibilityAuto: false },
    nodeId: nodeIds,
    plugins: PROFILE_KITS[profile],
    value,
  });
  useImperativeHandle(ref, () => editor, [editor]);
  useEffect(() => {
    if (itemId === null) {
      return;
    }
    return registerLiveEditor(itemId, editor);
  }, [itemId, editor]);
  return (
    <OpenItemProvider itemId={itemId}>
      <Plate editor={editor}>
        <PlateContent
          renderChunk={({ attributes, children, lowest }) =>
            lowest ? (
              <div {...attributes} className={EDITOR_CHUNK}>
                {children}
              </div>
            ) : (
              children
            )
          }
        />
      </Plate>
    </OpenItemProvider>
  );
};
