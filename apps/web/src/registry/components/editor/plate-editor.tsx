'use client';

import { Plate, usePlateEditor } from 'platejs/react';

import { EditorKit } from '@/registry/components/editor/editor-kit';
import { playgroundValue } from '@/registry/examples/values/playground-value';
import { Editor, EditorContainer } from '@/registry/ui/editor';
import { TocSidebar } from '@/registry/ui/toc-sidebar';

export function PlateEditor() {
  const editor = usePlateEditor({
    plugins: EditorKit,
    value: playgroundValue,
  });

  return (
    <Plate editor={editor}>
      <TocSidebar className="top-[130px]" topOffset={30} />

      <EditorContainer>
        <Editor placeholder="Type..." variant="demo" />
      </EditorContainer>
    </Plate>
  );
}
