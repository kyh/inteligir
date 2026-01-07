import type { Value } from 'platejs';

import { Plate, usePlateEditor } from 'platejs/react';

import { EditorKit } from '@/components/editor/editor-kit-app';
import { Editor } from '@/registry/ui/editor';

export function VersionPlate({
  children,
  ...props
}: React.PropsWithChildren<{
  id: string;
  value: Value;
}>) {
  const { id, value } = props;

  const editor = usePlateEditor({
    id,
    plugins: EditorKit,
    readOnly: true,
    value,
  });

  return (
    <Plate editor={editor} readOnly>
      <Editor autoFocus variant="versionHistory" />
    </Plate>
  );
}
