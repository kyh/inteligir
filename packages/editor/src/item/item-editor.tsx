// An item's rich surface, by its id: the editor over the item's own blocks (`item-session.ts`),
// which the session reads in, writes after a pause and lays changes from elsewhere into. The
// surface holds no copy of the value: a change only tells the session the value moved.

import { useEffect, useEffectEvent, useMemo } from "react";
import { Plate, usePlateEditor } from "platejs/react";

import { Editor, EditorContainer } from "@repo/editor/editor-chrome";
import { useEditorProfile } from "@repo/editor/editor-profile";
import { WRITE_PLACEHOLDER } from "@repo/editor/kits/block-placeholder-kit";
import { PROFILE_KITS } from "@repo/editor/markdown-editor";

import { createItemSession } from "./item-session";
import type { ItemSession, ItemSessionPorts } from "./item-session";

// a long item's top level renders in runs of this many blocks, as a note's does
const CHUNK_BLOCKS = 100;

export interface ItemEditorProps {
  readonly itemId: string;
  readonly ports: ItemSessionPorts;
  // the session, once it follows the item: what a host flushes and reads the status of
  readonly onSession: (session: ItemSession | null) => void;
}

export const ItemEditor = ({ itemId, ports, onSession }: ItemEditorProps) => {
  const profile = useEditorProfile();
  const editor = usePlateEditor({
    chunking: { chunkSize: CHUNK_BLOCKS, contentVisibilityAuto: false },
    navigationFeedback: false,
    plugins: PROFILE_KITS[profile],
  });
  // inert until it starts, so a render React discards builds one and leaves nothing running
  const session = useMemo(() => createItemSession(itemId, editor, ports), [itemId, editor, ports]);
  const announce = useEffectEvent((next: ItemSession | null) => {
    onSession(next);
  });
  useEffect(() => {
    void session.start();
    announce(session);
    return () => {
      announce(null);
      void session.close();
    };
  }, [session]);
  const handleValueChange = (): void => {
    session.edited();
  };
  return (
    <Plate editor={editor} onValueChange={handleValueChange}>
      <EditorContainer>
        <Editor placeholder={WRITE_PLACEHOLDER} spellCheck={false} />
      </EditorContainer>
    </Plate>
  );
};
