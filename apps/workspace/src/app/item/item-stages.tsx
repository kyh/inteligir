// CLAUDE.md § THE LIBRARY IS HOME, AND AN ITEM IS SHOWN BY ITS KIND. The stages an item is shown
// on, full size in the item view and in Quick Look alike. Every byte-route url carries the
// boot's media token, which AVFoundation's loader needs for a video's range requests. A PDF is a
// same-origin frame over the asset route, whose policy for it is WebKit's own viewer; a page copy
// is framed by its own route, whose policy sandboxes it.

import { vaultAssetUrl } from "@repo/contract/local/routes";
import { openExternalUrl } from "@repo/editor/lib/url";
import { FileKindIcon } from "@repo/editor/nodes/file-card";
import { basenamePath } from "@repo/notes/knowledge/vault-path";
import { Button } from "@repo/ui/components/button";
import { Shimmer } from "@repo/ui/ai/selection-actions";
import { cn } from "@repo/ui/lib/cn";
import { ExternalLinkIcon, FolderSearchIcon, SquareArrowOutUpRightIcon } from "lucide-react";
import { useState } from "react";

import { desktopPaths, runPathAction } from "../desktop-paths";
import { formatBytes } from "../library/item-labels";
import type { MediaOrigin } from "../vault-hooks";

const savedLabel = (savedMs: number): string =>
  new Date(savedMs).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

// where a saved page came from, over its text: the site, its address and the way back to it
export const SourceHeader = ({
  url,
  site,
  host,
  savedMs,
  className,
}: {
  url: string;
  site: string | null;
  host: string | null;
  savedMs: number | null;
  className?: string;
}) => {
  const name = site ?? host ?? url;
  return (
    <div
      data-source-header=""
      className={cn("flex items-center gap-3 border-b border-line px-6 py-3", className)}
    >
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-subtitle font-semibold text-ink-2"
      >
        {name.slice(0, 1).toLocaleUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-subtitle font-medium text-ink">{name}</p>
        <p className="m-0 truncate text-body text-muted-foreground">
          {url}
          {savedMs === null ? null : <span> · Saved {savedLabel(savedMs)}</span>}
        </p>
      </div>
      <Button
        variant="secondary"
        size="compact"
        leadingIcon={ExternalLinkIcon}
        onClick={() => {
          openExternalUrl(url);
        }}
      >
        Open original ↗
      </Button>
    </div>
  );
};

// fitted to the column; a click shows it at its own size, and the stage scrolls to pan
export const ImageStage = ({ file, media }: { file: string; media: MediaOrigin }) => {
  const [actual, setActual] = useState(false);
  return (
    <div
      data-item-stage="image"
      className={cn(
        "flex min-h-0 flex-1 overflow-auto bg-muted/30",
        actual ? "items-start justify-start" : "items-center justify-center p-6",
      )}
    >
      <button
        type="button"
        aria-label={actual ? "Fit to the window" : "Show at actual size"}
        aria-pressed={actual}
        className={cn("shrink-0 outline-none", actual ? "cursor-zoom-out" : "cursor-zoom-in")}
        onClick={() => {
          setActual((current) => !current);
        }}
      >
        <img
          alt={basenamePath(file)}
          src={vaultAssetUrl(media.origin, file, media.token)}
          className={cn(
            actual ? "max-w-none" : "max-h-[calc(100dvh-10rem)] max-w-full object-contain",
          )}
        />
      </button>
    </div>
  );
};

// WebKit's own viewer in a same-origin frame: the route's policy for a PDF carries no sandbox,
// which blanks it, and no <embed>, which no policy reaches
export const PdfStage = ({ file, media }: { file: string; media: MediaOrigin }) => (
  <div data-item-stage="pdf" className="flex min-h-0 flex-1">
    {/* oxlint-disable-next-line react/iframe-missing-sandbox -- a sandbox blanks WebKit's PDF viewer; the asset route's own policy for a PDF is what confines it */}
    <iframe
      title={basenamePath(file)}
      src={`${vaultAssetUrl(media.origin, file, media.token)}#view=FitH`}
      className="h-full w-full border-0"
    />
  </div>
);

export const MediaStage = ({
  file,
  kind,
  media,
}: {
  file: string;
  kind: "video" | "audio";
  media: MediaOrigin;
}) => {
  const src = vaultAssetUrl(media.origin, file, media.token);
  return (
    <div
      data-item-stage={kind}
      className="flex min-h-0 flex-1 items-center justify-center bg-muted/30 p-6"
    >
      {kind === "video" ? (
        <video controls preload="metadata" src={src} className="max-h-full max-w-full rounded-md">
          <track kind="captions" />
        </video>
      ) : (
        <audio controls preload="metadata" src={src} className="w-full max-w-lg">
          <track kind="captions" />
        </audio>
      )}
    </div>
  );
};

// a file the window cannot show: what it is, and the system's way to open it
export const FileStage = ({ file, bytes }: { file: string; bytes: number | null }) => {
  const paths = desktopPaths();
  return (
    <div
      data-item-stage="file"
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <FileKindIcon
        path={file}
        aria-hidden
        className="size-14 text-muted-foreground"
        strokeWidth={1.25}
      />
      <div>
        <p className="m-0 text-title font-medium text-ink">{basenamePath(file)}</p>
        {bytes === null ? null : (
          <p className="m-0 text-body text-muted-foreground">{formatBytes(bytes)}</p>
        )}
      </div>
      {paths === undefined ? null : (
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="compact"
            leadingIcon={SquareArrowOutUpRightIcon}
            onClick={() => {
              runPathAction(
                async () => await paths.open({ path: file }),
                `Could not open ${file}.`,
              );
            }}
          >
            Open with default app
          </Button>
          <Button
            variant="secondary"
            size="compact"
            leadingIcon={FolderSearchIcon}
            onClick={() => {
              runPathAction(
                async () => await paths.reveal({ path: file }),
                `Could not reveal ${file}.`,
              );
            }}
          >
            Reveal in Finder
          </Button>
        </div>
      )}
    </div>
  );
};

// CLAUDE.md § A PENDING STUB OPENS AS ITS PLACEHOLDER, NEVER THE EDITOR: no keystroke lands in
// a stub the fill is about to rewrite
export const PendingStage = () => (
  <div
    data-item-stage="pending"
    aria-live="polite"
    className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 p-8 text-center"
  >
    <Shimmer className="text-title font-medium">Filling in…</Shimmer>
    <p className="m-0 text-subtitle text-muted-foreground">This item’s page is being read.</p>
  </div>
);
