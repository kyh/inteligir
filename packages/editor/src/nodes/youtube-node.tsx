// Vendored from plate (github.com/udecode/plate), MIT. © Plate contributors.

import { lazy, Suspense } from "react";
import { parseVideoUrl } from "@platejs/media";
import { PlateElement, useFocused, useSelected, type PlateElementProps } from "platejs/react";

import { cn } from "cn";

import { stringProp } from "@repo/editor/node-props";
import { MediaToolbar } from "@repo/editor/nodes/media-toolbar";

// the stylesheet rides the lazy chunk; a static import would land it in the initial bundle.
const LiteYouTubeEmbed = lazy(() =>
  Promise.all([
    import("react-lite-youtube-embed"),
    import("react-lite-youtube-embed/dist/LiteYouTubeEmbed.css"),
  ]).then(([mod]) => ({ default: mod.default })),
);

// a Map, not a record: the provider name is an open string.
const PROVIDER_ASPECT = new Map([
  ["coub", "pb-[51.25%]"],
  ["dailymotion", "pb-[56.0417%]"],
  ["vimeo", "pb-[75%]"],
  ["youku", "pb-[56.25%]"],
]);

export function VideoElement(props: PlateElementProps) {
  const selected = useSelected();
  const focused = useFocused();
  const url = stringProp(props.element, "url") ?? "";
  const embed = parseVideoUrl(url);

  return (
    <PlateElement {...props} className="py-2.5">
      <figure className="group/media relative m-0 w-full" contentEditable={false}>
        {embed?.provider === "youtube" && embed.id ? (
          <div
            className={cn(
              "overflow-hidden rounded-md",
              focused && selected && "ring-2 ring-ring ring-offset-2",
            )}
          >
            <Suspense fallback={<div className="aspect-video w-full animate-pulse bg-muted" />}>
              <LiteYouTubeEmbed id={embed.id} title="YouTube video" />
            </Suspense>
          </div>
        ) : embed ? (
          <div
            className={cn("relative", PROVIDER_ASPECT.get(embed.provider ?? "") ?? "pb-[56.25%]")}
          >
            <iframe
              allowFullScreen
              sandbox="allow-scripts allow-presentation"
              className={cn(
                "absolute top-0 left-0 size-full rounded-md border-0",
                focused && selected && "ring-2 ring-ring ring-offset-2",
              )}
              src={embed.url}
              title="Video embed"
            />
          </div>
        ) : (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            Video: <span className="break-all">{url || "no URL"}</span>
          </div>
        )}
        <MediaToolbar />
      </figure>
      {props.children}
    </PlateElement>
  );
}
