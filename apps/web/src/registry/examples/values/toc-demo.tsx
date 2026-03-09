"use client";

import { Plate, usePlateEditor } from "platejs/react";

import { EditorKit } from "@/registry/components/editor/editor-kit";
import { tocValue } from "@/registry/examples/values/toc-value";
import { Editor, EditorContainer } from "@/registry/ui/editor";
import { TocSidebar } from "@/registry/ui/toc-sidebar";

export default function TocDemo() {
  const editor = usePlateEditor({
    plugins: EditorKit,
    value: tocValue,
  });

  return (
    <Plate editor={editor}>
      <TocSidebar className="*:top-12" topOffset={30} />

      <EditorContainer className="flex" variant="demo">
        <Editor className="h-fit" variant="demo" />
      </EditorContainer>
    </Plate>
  );
}
