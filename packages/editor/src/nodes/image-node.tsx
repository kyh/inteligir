// A vault src is fetched through the host's asset route into an object URL; the media type rides
// the Blob, so this file owns no extension table that could drift from the routes'. The src is
// resolved as the knowledge index resolves it, so a moved note's re-based url still loads and an
// image Problems calls missing is the one drawn missing.

import { useEffect, useState } from "react";
import { NodeApi } from "platejs";
import type { TElement } from "platejs";
import { PlateElement, useSelected } from "platejs/react";
import type { PlateElementProps } from "platejs/react";
import { ImageOff } from "lucide-react";

import { cn } from "@repo/ui/lib/cn";

import { useVaultLinkTarget } from "@repo/editor/host";
import { getEditorHostIo } from "@repo/editor/host-io";
import { isHttpUrl } from "@repo/editor/lib/wire";
import { useOpenNotePath } from "@repo/editor/note/open-note-context";
import { stringProp } from "@repo/editor/node-props";
import { RemoteContentCard } from "@repo/editor/nodes/remote-content-card";

type VaultState = { kind: "loading" } | { kind: "ready"; url: string } | { kind: "error" };

// null: a src no vault path answers, which is drawn missing
const useVaultAsset = (path: string | null): VaultState => {
  const [fetched, setFetched] = useState<VaultState>({ kind: "loading" });
  // re-key during the render that changes the path so no frame shows the previous file's object URL.
  const [fetchedPath, setFetchedPath] = useState(path);
  if (fetchedPath !== path) {
    setFetchedPath(path);
    setFetched({ kind: "loading" });
  }

  useEffect(() => {
    if (path === null) {
      return;
    }
    const io = getEditorHostIo();
    let objectUrl: string | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const result = await io.readVaultAsset({ path });
        if (cancelled) {
          return;
        }
        if (!result.ok) {
          setFetched({ kind: "error" });
          return;
        }
        objectUrl = URL.createObjectURL(result.bytes);
        setFetched({ kind: "ready", url: objectUrl });
      } catch {
        if (!cancelled) {
          setFetched({ kind: "error" });
        }
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl !== null) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [path]);

  return path === null ? { kind: "error" } : fetched;
};

// alt text lives in the img node's `caption` children (Plate's markdown img rule).
const altText = (element: TElement): string => {
  const { caption } = element;
  if (Array.isArray(caption)) {
    const text = caption.map((node) => (NodeApi.isNode(node) ? NodeApi.string(node) : "")).join("");
    if (text) {
      return text;
    }
  }
  const url = stringProp(element, "url") ?? "";
  return url.split("/").at(-1) ?? "";
};

const ImageBody = ({
  alt,
  selected,
  state,
  url,
}: {
  alt: string;
  selected: boolean;
  state: VaultState;
  url: string;
}) => {
  if (state.kind === "ready") {
    return (
      <img
        alt={alt}
        className={cn("max-w-full rounded-md", selected && "ring-2 ring-ring ring-offset-2")}
        src={state.url}
      />
    );
  }
  if (state.kind === "loading") {
    return <div className="h-40 w-full max-w-sm animate-pulse rounded-md bg-muted" />;
  }
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground",
        selected && "ring-2 ring-ring ring-offset-2",
      )}
    >
      <ImageOff className="size-4 shrink-0" />
      <span className="truncate">Missing image: {url}</span>
    </div>
  );
};

// `notePath` is the note the url is written in, which for an embedded note is not the open one.
export const ImageFigure = ({
  element,
  notePath,
  selected,
}: {
  element: TElement;
  notePath: string | null;
  selected: boolean;
}) => {
  const url = stringProp(element, "url") ?? "";
  const external = isHttpUrl(url);
  const linked = useVaultLinkTarget(url, notePath);
  // a miss falls back to the url as a root path: a just-pasted asset is on disk before the
  // listing that would resolve it
  const vaultState = useVaultAsset(
    external || linked === null ? null : (linked.path ?? linked.target),
  );

  return (
    <figure className="group/image relative m-0 w-full" contentEditable={false}>
      {external ? (
        <RemoteContentCard kind="image" selected={selected} url={url} />
      ) : (
        <ImageBody alt={altText(element)} selected={selected} state={vaultState} url={url} />
      )}
    </figure>
  );
};

export const ImageElement = (props: PlateElementProps) => {
  const selected = useSelected();
  const notePath = useOpenNotePath();
  return (
    <PlateElement {...props} className="py-2.5">
      <ImageFigure element={props.element} notePath={notePath} selected={selected} />
      {props.children}
    </PlateElement>
  );
};
