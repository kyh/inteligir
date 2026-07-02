// Floating controls shown on a selected embed node (video/media_embed/file):
// URL edit (writes the node's `url` through setNodes — serialized), Open in
// browser, Delete. Rendered inside the node's non-editable figure, so no
// popover primitive is needed — minimal by design; WP3's menu/popover pass
// may restyle it. URL entry only, uploads are out of scope.

import { useEffect, useRef, useState } from "react";
import { CheckIcon, ExternalLinkIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useEditorRef, useElement, useReadOnly, useSelected } from "platejs/react";

import { cn } from "@repo/ui/lib/utils";

const BUTTON_CLASS =
  "flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-3.5";

export function MediaToolbar() {
  const editor = useEditorRef();
  const element = useElement();
  const readOnly = useReadOnly();
  const selected = useSelected();
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const url = typeof element.url === "string" ? element.url : "";

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);
  useEffect(() => {
    if (!selected) setEditing(false);
  }, [selected]);

  if (readOnly) return null;

  const commitUrl = () => {
    const next = inputRef.current?.value.trim();
    const at = editor.api.findPath(element);
    if (next && next !== url && at) editor.tf.setNodes({ url: next }, { at });
    setEditing(false);
  };

  const remove = () => {
    const at = editor.api.findPath(element);
    if (at) editor.tf.removeNodes({ at });
  };

  return (
    <div
      contentEditable={false}
      className={cn(
        "absolute top-1.5 right-1.5 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-0.5 shadow-md select-none",
        selected ? "opacity-100" : "pointer-events-none opacity-0",
        "transition-opacity",
      )}
    >
      {editing ? (
        <>
          <input
            ref={inputRef}
            defaultValue={url}
            placeholder="https://…"
            className="h-6 w-56 rounded-md border border-border bg-background px-2 text-xs outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter") commitUrl();
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <button type="button" title="Apply URL" className={BUTTON_CLASS} onClick={commitUrl}>
            <CheckIcon />
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            title="Edit URL"
            className={BUTTON_CLASS}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setEditing(true)}
          >
            <PencilIcon />
          </button>
          <button
            type="button"
            title="Open original"
            className={BUTTON_CLASS}
            onClick={() => {
              if (url) window.open(url, "_blank", "noopener,noreferrer");
            }}
          >
            <ExternalLinkIcon />
          </button>
          <button
            type="button"
            title="Delete embed"
            className={cn(BUTTON_CLASS, "hover:bg-destructive/10 hover:text-destructive")}
            onClick={remove}
          >
            <Trash2Icon />
          </button>
        </>
      )}
    </div>
  );
}
