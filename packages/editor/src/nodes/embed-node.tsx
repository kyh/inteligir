// Vendored from plate (github.com/udecode/plate), MIT. © Plate contributors.
// A note is untrusted content: only http(s) URLs reach a live frame.

import { lazy, Suspense } from "react";
import { parseTwitterUrl } from "@platejs/media";
import { PlateElement, useFocused, useSelected, type PlateElementProps } from "platejs/react";

import { isHttpUrl } from "@repo/editor/lib/wire";
import { cn } from "@repo/ui/lib/utils";

import { useDarkClass } from "@repo/editor/lib/use-dark-class";
import { stringProp } from "@repo/editor/node-props";
import { MediaToolbar } from "@repo/editor/nodes/media-toolbar";

const Tweet = lazy(() => import("react-tweet").then((mod) => ({ default: mod.Tweet })));

export function MediaEmbedElement(props: PlateElementProps) {
  const selected = useSelected();
  const focused = useFocused();
  const dark = useDarkClass();
  const url = stringProp(props.element, "url") ?? "";
  const tweet = parseTwitterUrl(url);

  // sandbox="allow-scripts" only: no allow-same-origin (the frame would reach this origin) and no allow-popups.
  return (
    <PlateElement {...props} className="py-2.5">
      <figure className="group/media relative m-0 w-full" contentEditable={false}>
        {tweet?.id ? (
          <div
            className={cn(
              "flex justify-center text-left [&_.react-tweet-theme]:my-0",
              selected && "[&_.react-tweet-theme]:ring-2 [&_.react-tweet-theme]:ring-ring",
            )}
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
