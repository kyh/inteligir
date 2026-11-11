// A picture in an item is a block the library holds: by its bytes' sha, drawn from where the host
// draws its files, or by a web address, which the page never loads (`RemoteContentCard`).

import { NodeApi } from "platejs";
import type { TElement } from "platejs";
import { PlateElement, useSelected } from "platejs/react";
import type { PlateElementProps } from "platejs/react";
import { ImageOff } from "lucide-react";

import { cn } from "@repo/ui/lib/cn";

import { isHttpUrl } from "@repo/editor/lib/url";
import { stringProp } from "@repo/editor/node-props";
import { useLibraryFile } from "@repo/editor/nodes/library-file";
import { RemoteContentCard } from "@repo/editor/nodes/remote-content-card";

// alt text lives in the img node's `caption` children (Plate's markdown img rule).
const altText = (element: TElement): string => {
  const { caption } = element;
  if (Array.isArray(caption)) {
    return caption.map((node) => (NodeApi.isNode(node) ? NodeApi.string(node) : "")).join("");
  }
  return "";
};

const Missing = ({ label, selected }: { label: string; selected: boolean }) => (
  <div
    className={cn(
      "flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-subtitle text-muted-foreground",
      selected && "ring-2 ring-ring ring-offset-2",
    )}
  >
    <ImageOff className="size-4 shrink-0" />
    <span className="truncate">{label}</span>
  </div>
);

const LibraryPicture = ({
  alt,
  selected,
  sha,
}: {
  alt: string;
  selected: boolean;
  sha: string;
}) => {
  const file = useLibraryFile(sha);
  if (file.kind === "ready") {
    return (
      <img
        alt={alt}
        className={cn("max-w-full rounded-md", selected && "ring-2 ring-ring ring-offset-2")}
        src={file.url}
      />
    );
  }
  if (file.kind === "loading") {
    return <div className="h-40 w-full max-w-sm animate-pulse rounded-md bg-muted" />;
  }
  return <Missing label="This picture isn't on this device yet." selected={selected} />;
};

const ImageFigure = ({ element, selected }: { element: TElement; selected: boolean }) => {
  const sha = stringProp(element, "sha") ?? null;
  const url = stringProp(element, "url") ?? "";
  const body = () => {
    if (sha !== null) {
      return <LibraryPicture alt={altText(element)} selected={selected} sha={sha} />;
    }
    if (isHttpUrl(url)) {
      return <RemoteContentCard kind="image" selected={selected} url={url} />;
    }
    return <Missing label={`Missing image: ${url}`} selected={selected} />;
  };
  return (
    <figure className="group/image relative m-0 w-full" contentEditable={false}>
      {body()}
    </figure>
  );
};

export const ImageElement = (props: PlateElementProps) => {
  const selected = useSelected();
  return (
    <PlateElement {...props} className="py-2.5">
      <ImageFigure element={props.element} selected={selected} />
      {props.children}
    </PlateElement>
  );
};
