import type { Extension } from "@codemirror/state";
import { type ReactElement, useEffect, useLayoutEffect, useRef } from "react";
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

  // Layout effect, not a passive one: editor events can fire between the
  // commit and passive effects (focus handlers, a queued dispatch), and a
  // passive sync would hand them the previous render's callbacks.
  useLayoutEffect(() => {
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
    // The null on teardown must go to the SAME callback that received the
    // handle: reading the ref at cleanup time would skip a replaced callback
    // (the old one never learns the handle died, the new one gets a null for
    // an editor it never saw).
    const notifiedOnEditor = propsRef.current.onEditor;
    notifiedOnEditor?.(editor);
    return () => {
      notifiedOnEditor?.(null);
      editor.destroy();
    };
  }, []);

  return <div ref={containerRef} className={props.className} />;
};
