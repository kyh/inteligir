/* Adapted from Plate Plus Potion (https://pro.platejs.org) — used under the
 * held Plate Plus license. */
// `media_embed` node (URL-only): tweets render through react-tweet (lazy —
// it's a hefty chunk with theme CSS); any other http(s) URL gets a sandboxed
// generic iframe. A note is untrusted content, so the frame is scheme-gated:
// javascript:/data:/file:/relative URLs render a blocked placeholder, never a
// live frame. No resize, no captions — the canonical byte-form stays
// `<media_embed src="…" />`.

import { lazy, Suspense } from "react";
import { parseTwitterUrl } from "@platejs/media";
import { PlateElement, useFocused, useSelected, type PlateElementProps } from "platejs/react";

import { isHttpUrl } from "@repo/bridge/wire-helpers";
import { cn } from "@repo/ui/lib/utils";

import { useDarkClass } from "@renderer/lib/use-dark-class";
import { MediaToolbar } from "@renderer/editor/nodes/media-toolbar";

const Tweet = lazy(() => import("react-tweet").then((mod) => ({ default: mod.Tweet })));

export function MediaEmbedElement(props: PlateElementProps) {
  const selected = useSelected();
  const focused = useFocused();
  const dark = useDarkClass();
  const url = typeof props.element.url === "string" ? props.element.url : "";
  const tweet = parseTwitterUrl(url);

  return (
    <PlateElement {...props} className="py-2.5">
      <figure className="group/media relative m-0 w-full" contentEditable={false}>
        {tweet?.id ? (
          <div
            className={cn(
              "flex justify-center text-left [&_.react-tweet-theme]:my-0",
              selected && "[&_.react-tweet-theme]:ring-2 [&_.react-tweet-theme]:ring-ring",
            )}
            // react-tweet themes itself off this attribute; useDarkClass
            // keeps it live across theme flips (a one-shot read froze the
            // tweet on whichever theme it first rendered under).
            data-theme={dark ? "dark" : "light"}
          >
            <Suspense
              fallback={
                <div className="h-40 w-full max-w-[550px] animate-pulse rounded-xl bg-muted" />
              }
            >
              <Tweet id={tweet.id} />
            </Suspense>
          </div>
        ) : isHttpUrl(url) ? (
          // Minimal sandbox, mirroring the vault-.html app frame's discipline:
          // scripts only, NO allow-same-origin (the frame gets an opaque
          // origin and can never reach the app). allow-popups is gone — a
          // note embed must not spawn windows — and allow-presentation too
          // (cast/presentation isn't compiled into Electron).
          <iframe
            className={cn(
              "aspect-video w-full rounded-md border border-border",
              focused && selected && "ring-2 ring-ring ring-offset-2",
            )}
            sandbox="allow-scripts"
            src={url}
            title="Embed"
          />
        ) : (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            {url ? (
              <>
                Embed blocked — not an http(s) URL: <span className="break-all">{url}</span>
              </>
            ) : (
              "Embed: no URL"
            )}
          </div>
        )}
        <MediaToolbar />
      </figure>
      {props.children}
    </PlateElement>
  );
}
