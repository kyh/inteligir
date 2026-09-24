// Vendored from plate (github.com/udecode/plate), MIT. © Plate contributors.

import { PlateElement, useFocused, useSelected } from "platejs/react";
import type { PlateElementProps } from "platejs/react";

import { isHttpUrl } from "@repo/editor/lib/wire";

import { stringProp } from "@repo/editor/node-props";
import { MediaToolbar } from "@repo/editor/nodes/media-toolbar";
import { RemoteContentCard } from "@repo/editor/nodes/remote-content-card";

const EmbedBody = ({ selected, url }: { selected: boolean; url: string }) => {
  if (isHttpUrl(url)) {
    return <RemoteContentCard kind="page" selected={selected} url={url} />;
  }
  return (
    <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-subtitle text-muted-foreground">
      {url ? (
        <>
          Embed blocked — not an http(s) URL: <span className="break-all">{url}</span>
        </>
      ) : (
        "Embed: no URL"
      )}
    </div>
  );
};

export const MediaEmbedElement = (props: PlateElementProps) => {
  const selected = useSelected();
  const focused = useFocused();
  const url = stringProp(props.element, "url") ?? "";

  return (
    <PlateElement {...props} className="py-2.5">
      <figure className="group/media relative m-0 w-full" contentEditable={false}>
        <EmbedBody selected={focused && selected} url={url} />
        <MediaToolbar />
      </figure>
      {props.children}
    </PlateElement>
  );
};
