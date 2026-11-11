// A file block: one the library holds by its bytes' sha, drawn as a card naming it, or a web
// address, which a note is untrusted content for, so only an http(s) one reaches a clickable href.

import { FileTextIcon } from "lucide-react";
import { PlateElement, useFocused, useSelected } from "platejs/react";
import type { PlateElementProps } from "platejs/react";

import { isHttpUrl, isPdfUrl } from "@repo/editor/lib/url";
import { cn } from "@repo/ui/lib/cn";

import { stringProp } from "@repo/editor/node-props";
import { FileCard } from "@repo/editor/nodes/file-card";
import { MediaToolbar } from "@repo/editor/nodes/media-toolbar";
import { RemoteContentCard } from "@repo/editor/nodes/remote-content-card";

const WebFile = ({
  name,
  selected,
  url,
}: {
  name: string | null;
  selected: boolean;
  url: string;
}) =>
  isPdfUrl(url) && isHttpUrl(url) ? (
    <RemoteContentCard kind="pdf" selected={selected} url={url} />
  ) : (
    <a
      href={isHttpUrl(url) ? url : undefined}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-subtitle",
        selected && "ring-2 ring-ring ring-offset-2",
      )}
    >
      <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{name ?? url}</span>
    </a>
  );

export const FileElement = (props: PlateElementProps) => {
  const selected = useSelected();
  const focused = useFocused();
  const sha = stringProp(props.element, "sha") ?? null;
  const url = stringProp(props.element, "url") ?? "";
  const name = stringProp(props.element, "name") ?? null;
  const shown = focused && selected;

  return (
    <PlateElement {...props} className="py-2.5">
      <figure className="group/media relative m-0 w-full" contentEditable={false}>
        {sha === null ? (
          <WebFile name={name} selected={shown} url={url} />
        ) : (
          <FileCard name={name ?? "File"} selected={shown} sha={sha} />
        )}
        <MediaToolbar />
      </figure>
      {props.children}
    </PlateElement>
  );
};
