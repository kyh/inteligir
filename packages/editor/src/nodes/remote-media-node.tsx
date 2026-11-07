// Vendored from plate (github.com/udecode/plate), MIT. © Plate contributors.

import type { ReactNode } from "react";
import { PlateElement, useFocused, useSelected } from "platejs/react";
import type { PlateElementProps } from "platejs/react";

import { cn } from "@repo/ui/lib/cn";

import { isHttpUrl } from "@repo/editor/lib/url";

import { stringProp } from "@repo/editor/node-props";
import { useLibraryFile } from "@repo/editor/nodes/library-file";
import { MediaToolbar } from "@repo/editor/nodes/media-toolbar";
import { RemoteContentCard } from "@repo/editor/nodes/remote-content-card";

const Unplayable = ({ children }: { children: ReactNode }) => (
  <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-subtitle text-muted-foreground">
    {children}
  </div>
);

const NOT_HERE = "This recording isn't on this device yet.";

// a recording the library holds by its sha, played from where the host draws its files
export const LibraryVideo = ({ selected, sha }: { selected: boolean; sha: string }) => {
  const file = useLibraryFile(sha);
  if (file.kind === "ready") {
    return (
      // oxlint-disable-next-line jsx-a11y/media-has-caption -- a person's own recording has no caption track to offer
      <video
        controls
        src={file.url}
        className={cn("max-w-full rounded-md", selected && "ring-2 ring-ring ring-offset-2")}
      />
    );
  }
  if (file.kind === "loading") {
    return <div className="h-40 w-full max-w-sm animate-pulse rounded-md bg-muted" />;
  }
  return <Unplayable>{NOT_HERE}</Unplayable>;
};

// a video by its sha, or a web page or video by its address, which the page never loads
export const remoteMediaElement = (kind: "video" | "page") =>
  function RemoteMediaElement(props: PlateElementProps) {
    const selected = useSelected();
    const focused = useFocused();
    const sha = kind === "video" ? (stringProp(props.element, "sha") ?? null) : null;
    const url = stringProp(props.element, "url") ?? "";

    const body = () => {
      if (sha !== null) {
        return <LibraryVideo selected={focused && selected} sha={sha} />;
      }
      if (isHttpUrl(url)) {
        return <RemoteContentCard kind={kind} selected={focused && selected} url={url} />;
      }
      return url === "" ? (
        <Unplayable>No URL</Unplayable>
      ) : (
        <Unplayable>
          Not an http(s) URL: <span className="break-all">{url}</span>
        </Unplayable>
      );
    };

    return (
      <PlateElement {...props} className="py-2.5">
        <figure className="group/media relative m-0 w-full" contentEditable={false}>
          {body()}
          <MediaToolbar />
        </figure>
        {props.children}
      </PlateElement>
    );
  };
