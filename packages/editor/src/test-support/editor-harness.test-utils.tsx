import { useEffect, useImperativeHandle } from "react";
import type { Ref } from "react";
import { Plate, PlateContent, usePlateEditor } from "platejs/react";
import type { PlateEditor } from "platejs/react";
import type { Value } from "platejs";

import type { EditorProfile } from "@repo/editor/editor-profile";
import { registerLiveEditor } from "@repo/editor/live-editor";
import { PROFILE_KITS } from "@repo/editor/kits/profile-kits";
import { OpenItemPlugin } from "@repo/editor/open-item";
import { EDITOR_CHUNK } from "@repo/editor/style-hooks";

export const EditorHarness = ({
  value,
  itemId = null,
  ref,
  nodeIds = false,
  profile = "desktop",
  chunkSize,
  readOnly = false,
}: {
  value: Value;
  itemId?: string | null;
  ref?: Ref<PlateEditor>;
  nodeIds?: boolean;
  profile?: EditorProfile;
  chunkSize?: number;
  readOnly?: boolean;
}) => {
  const editor = usePlateEditor({
    chunking: chunkSize === undefined ? true : { chunkSize, contentVisibilityAuto: false },
    nodeId: nodeIds,
    plugins: [...PROFILE_KITS[profile], OpenItemPlugin.configure({ options: { itemId } })],
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
    <Plate editor={editor} readOnly={readOnly}>
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
  );
};
