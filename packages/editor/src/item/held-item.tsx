// An item's blocks as its host already holds them, drawn read-only under the host's words for why:
// what the item editor shows of a note it cannot open now (`item-editor.tsx`), until the note's
// live document syncs. A host drawing newer blocks mounts this anew, keyed by them.

import { normalizeNodeId } from "platejs";
import type { TElement } from "platejs";
import { Plate, usePlateEditor } from "platejs/react";

import type { LibraryBlock } from "@repo/contract/library/library-nodes";

import { Editor, EditorContainer } from "@repo/editor/editor-chrome";
import { useEditorProfile } from "@repo/editor/editor-profile";
import { PROFILE_KITS } from "@repo/editor/kits/profile-kits";
import { OpenItemProvider } from "@repo/editor/open-item";

import { Notice } from "./notice";

interface HeldItemProps {
  readonly itemId: string;
  readonly blocks: readonly LibraryBlock[];
  readonly notice: string;
}

export const HeldItem = ({ itemId, blocks, notice }: HeldItemProps) => {
  const profile = useEditorProfile();
  const value: TElement[] = [...blocks];
  const editor = usePlateEditor({
    navigationFeedback: false,
    nodeId: true,
    plugins: PROFILE_KITS[profile],
    value: normalizeNodeId(value),
  });
  return (
    <OpenItemProvider itemId={itemId}>
      <Notice profile={profile} text={notice} />
      <Plate editor={editor} readOnly>
        <EditorContainer>
          <Editor spellCheck={false} />
        </EditorContainer>
      </Plate>
    </OpenItemProvider>
  );
};
