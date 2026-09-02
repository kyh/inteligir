import { useEffect, useRef, useState } from "react";
import { CheckIcon, ExternalLinkIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useEditorRef, useElement, useReadOnly, useSelected } from "platejs/react";

import { cn } from "@repo/ui/lib/utils";
import { Button } from "@repo/ui/components/button";

import { stringProp } from "@repo/editor/node-props";

const BUTTON_CLASS = "rounded-md text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5";

export function MediaToolbar() {
  const editor = useEditorRef();
  const element = useElement();
  const readOnly = useReadOnly();
  const selected = useSelected();
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const url = stringProp(element, "url") ?? "";

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  // decided during render so the toolbar never paints an open input on an unselected embed.
  if (editing && !selected) setEditing(false);

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
        "absolute top-1.5 right-1.5 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-0.5 shadow-surface-4 select-none",
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
          <Button
            variant="ghost"
            size="icon-compact"
            title="Apply URL"
            className={BUTTON_CLASS}
            onClick={commitUrl}
          >
            <CheckIcon />
          </Button>
        </>
      ) : (
        <>
          <Button
            variant="ghost"
            size="icon-compact"
            title="Edit URL"
            className={BUTTON_CLASS}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setEditing(true)}
          >
            <PencilIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-compact"
            title="Open original"
            className={BUTTON_CLASS}
            onClick={() => {
              if (url) window.open(url, "_blank", "noopener,noreferrer");
            }}
          >
            <ExternalLinkIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-compact"
            title="Delete embed"
            className={cn(
              BUTTON_CLASS,
              "hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/10",
            )}
            onClick={remove}
          >
            <Trash2Icon />
          </Button>
        </>
      )}
    </div>
  );
}
