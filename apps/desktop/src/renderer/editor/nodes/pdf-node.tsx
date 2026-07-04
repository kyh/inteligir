// `file` node (URL-only): pdf URLs render in the browser's native pdf viewer
// via an iframe; other file URLs get a download-style link card. Vault-
// relative pdfs need a Bridge asset scheme — out of scope until the Bridge
// grows file-URL serving; this component then branches on relative paths.
// Canonical byte-form: `<file src="…" />` (a `name` attr survives if present
// in the source, but inserts never write one).

import { FileTextIcon } from "lucide-react";
import { PlateElement, useFocused, useSelected, type PlateElementProps } from "platejs/react";

import { cn } from "@repo/ui/lib/utils";

import { MediaToolbar } from "@renderer/editor/nodes/media-toolbar";

const PDF_RE = /\.pdf(?:[?#]|$)/i;

export function FileElement(props: PlateElementProps) {
  const selected = useSelected();
  const focused = useFocused();
  const url = typeof props.element.url === "string" ? props.element.url : "";
  const name = typeof props.element.name === "string" ? props.element.name : null;

  return (
    <PlateElement {...props} className="py-2.5">
      <figure className="group/media relative m-0 w-full" contentEditable={false}>
        {PDF_RE.test(url) ? (
          // No sandbox attr: the browser-native PDF viewer (a plugin document)
          // refuses to render inside a sandboxed frame — sandboxing here shows
          // a blank pane, which defeats the embed. The frame only ever hosts
          // the URL the note author wrote, same trust as clicking the link.
          // oxlint-disable-next-line react/iframe-missing-sandbox
          <iframe
            className={cn(
              "h-[70vh] w-full rounded-md border border-border",
              focused && selected && "ring-2 ring-ring ring-offset-2",
            )}
            src={url}
            title={name ?? "PDF document"}
          />
        ) : (
          <a
            href={url || undefined}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm",
              focused && selected && "ring-2 ring-ring ring-offset-2",
            )}
          >
            <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{name ?? url ?? "File"}</span>
          </a>
        )}
        <MediaToolbar />
      </figure>
      {props.children}
    </PlateElement>
  );
}
