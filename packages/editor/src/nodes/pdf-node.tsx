// A note is untrusted content: only an http(s) URL reaches a clickable href.

import { FileTextIcon } from "lucide-react";
import { PlateElement, useFocused, useSelected } from "platejs/react";
import type { PlateElementProps } from "platejs/react";

import { isHttpUrl, isPdfUrl } from "@repo/editor/lib/wire";
import { cn } from "@repo/ui/lib/cn";

import { stringProp } from "@repo/editor/node-props";
import { MediaToolbar } from "@repo/editor/nodes/media-toolbar";
import { RemoteContentCard } from "@repo/editor/nodes/remote-content-card";

export const FileElement = (props: PlateElementProps) => {
  const selected = useSelected();
  const focused = useFocused();
  const url = stringProp(props.element, "url") ?? "";
  const name = stringProp(props.element, "name") ?? null;

  return (
    <PlateElement {...props} className="py-2.5">
      <figure className="group/media relative m-0 w-full" contentEditable={false}>
        {isPdfUrl(url) && isHttpUrl(url) ? (
          <RemoteContentCard kind="pdf" selected={focused && selected} url={url} />
        ) : (
          <a
            href={isHttpUrl(url) ? url : undefined}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-subtitle",
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
};
