// A vault-relative src is fetched through the host's asset route into an object URL; the media
// type rides the Blob, so this file owns no extension table that could drift from the routes'.

import { useEffect, useState } from "react";
import { NodeApi, type TElement } from "platejs";
import { PlateElement, useSelected, type PlateElementProps } from "platejs/react";
import { ImageOff } from "lucide-react";

import { cn } from "cn";

import { getEditorHostIo } from "@repo/editor/host-io";
import { stringProp } from "@repo/editor/node-props";

const EXTERNAL_RE = /^https?:\/\//i;

type VaultState = { kind: "loading" } | { kind: "ready"; url: string } | { kind: "error" };

function useVaultAsset(path: string, external: boolean): VaultState {
  const [fetched, setFetched] = useState<VaultState>({ kind: "loading" });
  // re-key during the render that changes the path so no frame shows the previous file's object URL.
  const [fetchedPath, setFetchedPath] = useState(path);
  if (fetchedPath !== path) {
    setFetchedPath(path);
    setFetched({ kind: "loading" });
  }

  useEffect(() => {
    if (external) return;
    const io = getEditorHostIo();
    let objectUrl: string | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const result = await io.readVaultAsset({ path });
        if (cancelled) return;
        if (!result.ok) {
          setFetched({ kind: "error" });
          return;
        }
        objectUrl = URL.createObjectURL(result.bytes);
        setFetched({ kind: "ready", url: objectUrl });
      } catch {
        if (!cancelled) setFetched({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, external]);

  return external ? { kind: "ready", url: path } : fetched;
}

// alt text lives in the img node's `caption` children (Plate's markdown img rule).
function altText(element: TElement): string {
  const caption = element.caption;
  if (Array.isArray(caption)) {
    const text = caption.map((node) => (NodeApi.isNode(node) ? NodeApi.string(node) : "")).join("");
    if (text) return text;
  }
  const url = stringProp(element, "url") ?? "";
  return url.split("/").at(-1) ?? "";
}

export function ImageElement(props: PlateElementProps) {
  const selected = useSelected();
  const url = stringProp(props.element, "url") ?? "";
  const external = EXTERNAL_RE.test(url);
  const state = useVaultAsset(url, external);
  const alt = altText(props.element);

  return (
    <PlateElement {...props} className="py-2.5">
      <figure className="group/image relative m-0 w-full" contentEditable={false}>
        {state.kind === "ready" ? (
          <img
            alt={alt}
            className={cn("max-w-full rounded-md", selected && "ring-2 ring-ring ring-offset-2")}
            src={state.url}
          />
        ) : state.kind === "loading" ? (
          <div className="h-40 w-full max-w-sm animate-pulse rounded-md bg-muted" />
        ) : (
          <div
            className={cn(
              "flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground",
              selected && "ring-2 ring-ring ring-offset-2",
            )}
          >
            <ImageOff className="size-4 shrink-0" />
            <span className="truncate">Missing image: {url}</span>
          </div>
        )}
      </figure>
      {props.children}
    </PlateElement>
  );
}
