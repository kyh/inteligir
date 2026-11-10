// An item's blocks as its host already holds them, drawn read-only under the host's words for why:
// the phone's page, which opens no note's live document yet. Every surface that edits a note binds
// it live (`item-editor.tsx`). A host drawing newer blocks mounts this anew, keyed by them.

import { normalizeNodeId } from "platejs";
import { Plate, usePlateEditor } from "platejs/react";

import { Editor, EditorContainer } from "@repo/editor/editor-chrome";
import { useEditorProfile } from "@repo/editor/editor-profile";
import { PROFILE_KITS } from "@repo/editor/kits/profile-kits";
import type { NoteBlock } from "@repo/editor/live/note-blocks";
import { sectioned } from "@repo/editor/live/note-section";
import { OpenItemProvider } from "@repo/editor/open-item";

import { Notice } from "./item-editor";

interface HeldItemProps {
  readonly itemId: string;
  readonly blocks: readonly NoteBlock[];
  readonly notice: string;
}

export const HeldItem = ({ itemId, blocks, notice }: HeldItemProps) => {
  const profile = useEditorProfile();
  const editor = usePlateEditor({
    navigationFeedback: false,
    nodeId: true,
    plugins: PROFILE_KITS[profile],
    value: normalizeNodeId(blocks.map(({ block, section }) => sectioned(block, section))),
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
