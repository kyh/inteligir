// A note is untrusted content: only http(s) URLs reach a live iframe or a clickable href.

import { FileTextIcon } from "lucide-react";
import { PlateElement, useFocused, useSelected, type PlateElementProps } from "platejs/react";

import { isHttpUrl } from "@repo/editor/lib/wire";
import { cn } from "cn";

import { stringProp } from "@repo/editor/node-props";
import { MediaToolbar } from "@repo/editor/nodes/media-toolbar";

const PDF_RE = /\.pdf(?:[?#]|$)/i;

export function FileElement(props: PlateElementProps) {
  const selected = useSelected();
  const focused = useFocused();
  const url = stringProp(props.element, "url") ?? "";
  const name = stringProp(props.element, "name") ?? null;

  // The pdf iframe has no sandbox: Chromium blocks the native PDF viewer inside any sandboxed
  // frame (every token set yields ERR_BLOCKED_BY_CLIENT). It hosts only the http(s) URL the
  // author wrote — the same trust as clicking the link.
  return (
    <PlateElement {...props} className="py-2.5">
      <figure className="group/media relative m-0 w-full" contentEditable={false}>
        {PDF_RE.test(url) && isHttpUrl(url) ? (
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
            href={isHttpUrl(url) ? url : undefined}
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
