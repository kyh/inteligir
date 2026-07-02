// Link anchor + its popover: clicking a link opens a Base UI popover anchored
// to the anchor element with the URL, Open, Edit (swaps to an input; submit
// rewrites the node's url), and Unlink. Creation stays in the selection
// toolbar's in-bar link input; this popover manages existing links only.

import { useRef, useState } from "react";
import { unwrapLink } from "@platejs/link";
import { ExternalLinkIcon, PencilIcon, Unlink2Icon } from "lucide-react";
import {
  PlateElement,
  useEditorRef,
  useElement,
  useReadOnly,
  type PlateElementProps,
} from "platejs/react";

import { cn } from "@repo/ui/lib/utils";
import { Popover, PopoverContent } from "@repo/ui/components/popover";

function PopoverButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md text-foreground/80 transition-colors hover:bg-accent [&_svg]:size-4"
    >
      {children}
    </button>
  );
}

export function LinkElement(props: PlateElementProps) {
  const editor = useEditorRef();
  const element = useElement();
  const readOnly = useReadOnly();
  const anchorRef = useRef<HTMLAnchorElement | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const url = typeof element.url === "string" ? element.url : "";

  const close = () => {
    setOpen(false);
    setEditing(false);
  };

  const applyDraft = () => {
    const next = draft.trim();
    const at = editor.api.findPath(element);
    if (next && at) editor.tf.setNodes({ url: next }, { at });
    close();
    editor.tf.focus();
  };

  const removeLink = () => {
    const at = editor.api.findPath(element);
    if (at) unwrapLink(editor, { at });
    close();
    editor.tf.focus();
  };

  return (
    <PlateElement
      {...props}
      ref={anchorRef}
      as="a"
      className="cursor-pointer border-b border-current font-medium text-foreground/70"
      attributes={{
        ...props.attributes,
        href: url,
        onClick: (event: React.MouseEvent) => {
          // The popover owns navigation (its Open button); a raw click must
          // not leave the app.
          event.preventDefault();
          if (!readOnly) setOpen(true);
        },
      }}
    >
      {props.children}
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setEditing(false);
        }}
      >
        <PopoverContent anchor={anchorRef} side="bottom" align="start" className="p-1">
          {editing ? (
            <form
              className="flex items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                applyDraft();
              }}
            >
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setEditing(false);
                }}
                placeholder="https://…"
                className="h-7 w-56 bg-transparent px-1.5 text-xs outline-none placeholder:text-muted-foreground"
              />
              <button
                type="submit"
                className="flex items-center rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
              >
                Apply
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-0.5">
              <span
                className={cn("max-w-56 truncate px-1.5 text-xs text-muted-foreground")}
                title={url}
              >
                {url}
              </span>
              <PopoverButton title="Open link" onClick={() => window.open(url, "_blank")}>
                <ExternalLinkIcon />
              </PopoverButton>
              <PopoverButton
                title="Edit link"
                onClick={() => {
                  setDraft(url);
                  setEditing(true);
                }}
              >
                <PencilIcon />
              </PopoverButton>
              <PopoverButton title="Remove link" onClick={removeLink}>
                <Unlink2Icon />
              </PopoverButton>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </PlateElement>
  );
}
