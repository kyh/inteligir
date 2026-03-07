import { Plate, usePlateEditor } from 'platejs/react';

import { EditorKit } from '@/registry/components/editor/editor-kit';
import { DEMO_VALUES } from '@/registry/examples/values/demo-values';
import { Editor, EditorContainer } from '@/registry/ui/editor';

export default function Demo({ id }: { id: keyof typeof DEMO_VALUES }) {
  const editor = usePlateEditor({
    plugins: EditorKit,
    value: DEMO_VALUES[id],
  });

  return (
    <Plate editor={editor}>
      <EditorContainer variant="demo">
        <Editor variant="demo" />
      </EditorContainer>
    </Plate>
  );
}
