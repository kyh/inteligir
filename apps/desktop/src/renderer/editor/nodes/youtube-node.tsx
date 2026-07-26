/* Adapted from Plate Plus Potion (https://pro.platejs.org) — used under the
 * held Plate Plus license. */
// `video` node (URL-only, no uploads/resize/captions): youtube renders through
// react-lite-youtube-embed (thumbnail-first, no iframe until click); every
// other provider parseVideoUrl understands (vimeo/dailymotion/coub/youku)
// renders its embed URL in a player iframe. Unparseable URLs fall back to a
// plain link card. Never writes `align`/`width`/`isUpload` — the canonical
// byte-form stays `<video src="…" />`.

import { lazy, Suspense } from "react";
import { parseVideoUrl } from "@platejs/media";
import { PlateElement, useFocused, useSelected, type PlateElementProps } from "platejs/react";

import { cn } from "@repo/ui/lib/utils";

import { MediaToolbar } from "@renderer/editor/nodes/media-toolbar";

// The stylesheet rides the same lazy chunk as the component (Vite injects it
// when the dynamic import resolves) — a static import would put it in the
// initial bundle for notes that never embed a video.
const LiteYouTubeEmbed = lazy(() =>
  Promise.all([
    import("react-lite-youtube-embed"),
    import("react-lite-youtube-embed/dist/LiteYouTubeEmbed.css"),
  ]).then(([mod]) => ({ default: mod.default })),
);

// Aspect paddings mirror potion's per-provider ratios.
const PROVIDER_ASPECT: Record<string, string> = {
  coub: "pb-[51.25%]",
  dailymotion: "pb-[56.0417%]",
  vimeo: "pb-[75%]",
  youku: "pb-[56.25%]",
};

export function VideoElement(props: PlateElementProps) {
  const selected = useSelected();
  const focused = useFocused();
  const url = typeof props.element.url === "string" ? props.element.url : "";
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
          <div className={cn("relative", PROVIDER_ASPECT[embed.provider ?? ""] ?? "pb-[56.25%]")}>
            <iframe
              allowFullScreen
              // No allow-popups: an embedded player has no business spawning
              // windows, and embed-node carries the same trim. The src is
              // provider-constructed from a parsed video id, so this is
              // defense-in-depth consistency rather than a live hole.
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
