// Vendored from plate (github.com/udecode/plate), MIT. © Plate contributors.
// A note is untrusted content: only http(s) URLs reach a live frame.

import { lazy, Suspense } from "react";
import { parseTwitterUrl } from "@platejs/media";
import { PlateElement, useFocused, useSelected } from "platejs/react";
import type { PlateElementProps } from "platejs/react";

import { isHttpUrl } from "@repo/editor/lib/wire";
import { cn } from "cn";

import { useDarkClass } from "@repo/editor/lib/use-dark-class";
import { stringProp } from "@repo/editor/node-props";
import { MediaToolbar } from "@repo/editor/nodes/media-toolbar";

const Tweet = lazy(async () => await import("react-tweet").then((mod) => ({ default: mod.Tweet })));

// sandbox="allow-scripts" only: no allow-same-origin (the frame would reach this origin) and no allow-popups.
const EmbedBody = ({
  dark,
  focused,
  selected,
  tweetId,
  url,
}: {
  dark: boolean;
  focused: boolean;
  selected: boolean;
  tweetId: string;
  url: string;
}) => {
  if (tweetId) {
    return (
      <div
        className={cn(
          "flex justify-center text-left [&_.react-tweet-theme]:my-0",
          selected && "[&_.react-tweet-theme]:ring-2 [&_.react-tweet-theme]:ring-ring",
        )}
        data-theme={dark ? "dark" : "light"}
      >
        <Suspense
          fallback={<div className="h-40 w-full max-w-[550px] animate-pulse rounded-xl bg-muted" />}
        >
          <Tweet id={tweetId} />
        </Suspense>
      </div>
    );
  }
  if (isHttpUrl(url)) {
    return (
      <iframe
        className={cn(
          "aspect-video w-full rounded-md border border-border",
          focused && selected && "ring-2 ring-ring ring-offset-2",
        )}
        sandbox="allow-scripts"
        src={url}
        title="Embed"
      />
    );
  }
  return (
    <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
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
  const dark = useDarkClass();
  const url = stringProp(props.element, "url") ?? "";
  const tweet = parseTwitterUrl(url);

  return (
    <PlateElement {...props} className="py-2.5">
      <figure className="group/media relative m-0 w-full" contentEditable={false}>
        <EmbedBody
          dark={dark}
          focused={focused}
          selected={selected}
          tweetId={tweet?.id ?? ""}
          url={url}
        />
        <MediaToolbar />
      </figure>
      {props.children}
    </PlateElement>
  );
};
