import type { Extension } from "@codemirror/state";
import { type ReactElement, useEffect, useRef } from "react";
import {
  createMarkdownEditor,
  type MarkdownEditor as MarkdownEditorHandle,
} from "../create-markdown-editor";

export interface MarkdownEditorProps {
  /** Markdown mounted into the editor. Fixed at mount — the editor owns the
   * buffer afterwards; push external changes through the handle's setDoc. */
  initialDoc?: string;
  onDocChanged?: (doc: string) => void;
  onOpenLink?: (url: string) => void;
  /** Extra extensions appended after the house stack; fixed at mount. */
  extensions?: Extension[];
  className?: string;
  /** Receives the live editor handle after mount, null on unmount. */
  onEditor?: (editor: MarkdownEditorHandle | null) => void;
}

/**
 * Thin React wrapper over createMarkdownEditor: one mount, one teardown.
 * Handlers are read through refs so re-renders never rebuild the editor.
 */
export const MarkdownEditor = (props: MarkdownEditorProps): ReactElement => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef(props);

  useEffect(() => {
    propsRef.current = props;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const editor = createMarkdownEditor({
      parent: container,
      doc: propsRef.current.initialDoc ?? "",
      onDocChanged: (doc) => propsRef.current.onDocChanged?.(doc),
      onOpenLink: (url) => {
        const handler = propsRef.current.onOpenLink;
        if (handler) handler(url);
        else window.open(url, "_blank", "noopener");
      },
      extensions: propsRef.current.extensions ?? [],
    });
    propsRef.current.onEditor?.(editor);
    return () => {
      propsRef.current.onEditor?.(null);
      editor.destroy();
    };
  }, []);

  return <div ref={containerRef} className={props.className} />;
};
