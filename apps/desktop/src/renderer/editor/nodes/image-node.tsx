// `img` node (markdown `![alt](src)`). Two rendering paths: an external
// `http(s)` src renders as a plain `<img>` (no bytes cross the Bridge); a
// vault-relative path is fetched lazily through the Bridge (readVaultAsset →
// base64 → object URL) because the renderer is sandboxed and can't read files
// itself. A path that doesn't resolve renders a broken-file placeholder rather
// than a crash. No resize/align/caption chrome — the canonical byte form stays
// bare `![alt](path)`.

import { useEffect, useState } from "react";
import { NodeApi, type TElement } from "platejs";
import { PlateElement, useSelected, type PlateElementProps } from "platejs/react";
import { ImageOff } from "lucide-react";

import { cn } from "@repo/ui/lib/utils";

import { getBridge } from "@renderer/lib/bridge";

const EXTERNAL_RE = /^https?:\/\//i;

function mimeFromPath(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "avif":
      return "image/avif";
    case "bmp":
      return "image/bmp";
    default:
      return "application/octet-stream";
  }
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

type VaultState = { kind: "loading" } | { kind: "ready"; url: string } | { kind: "error" };

// Resolve a vault-relative asset to an object URL via the Bridge, revoking it
// on cleanup / path change. External srcs never enter here.
function useVaultAsset(path: string, external: boolean): VaultState {
  const [state, setState] = useState<VaultState>(
    external ? { kind: "ready", url: path } : { kind: "loading" },
  );

  useEffect(() => {
    if (external) {
      setState({ kind: "ready", url: path });
      return;
    }
    const bridge = getBridge();
    let objectUrl: string | null = null;
    let cancelled = false;
    setState({ kind: "loading" });
    void (async () => {
      try {
        const result = await bridge.readVaultAsset({ path });
        if (cancelled) return;
        if (!result.ok) {
          setState({ kind: "error" });
          return;
        }
        objectUrl = URL.createObjectURL(base64ToBlob(result.bytesBase64, mimeFromPath(path)));
        setState({ kind: "ready", url: objectUrl });
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, external]);

  return state;
}

// Alt text lives in the img node's `caption` children (Plate's markdown img
// rule), verbatim from `![alt](…)`; fall back to the file name.
function altText(element: TElement): string {
  const caption = element.caption;
  if (Array.isArray(caption)) {
    const text = caption.map((node) => (NodeApi.isNode(node) ? NodeApi.string(node) : "")).join("");
    if (text) return text;
  }
  const url = typeof element.url === "string" ? element.url : "";
  return url.split("/").at(-1) ?? "";
}

export function ImageElement(props: PlateElementProps) {
  const selected = useSelected();
  const url = typeof props.element.url === "string" ? props.element.url : "";
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
