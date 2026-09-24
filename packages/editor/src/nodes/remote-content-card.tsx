// The page's CSP refuses every remote image, frame and fetch on purpose: a remote embed would be a
// beacon on every open. So a remote url is never loaded, and the card hands it to the system
// browser instead.

import { ExternalLinkIcon, FileTextIcon, FilmIcon, GlobeIcon, ImageIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@repo/ui/components/button";
import { cn } from "@repo/ui/lib/cn";

import { openExternalUrl } from "@repo/editor/lib/wire";

type RemoteContentKind = "image" | "page" | "pdf" | "video";

const KIND_ICON = {
  image: ImageIcon,
  page: GlobeIcon,
  pdf: FileTextIcon,
  video: FilmIcon,
} satisfies Record<RemoteContentKind, LucideIcon>;

export const RemoteContentCard = ({
  kind,
  selected,
  url,
}: {
  kind: RemoteContentKind;
  selected: boolean;
  url: string;
}) => {
  const Icon = KIND_ICON[kind];
  // the action sits under the text, clear of the corner the media toolbar covers while selected.
  return (
    <div
      className={cn(
        "flex gap-3 rounded-md border border-border bg-muted/40 px-3 py-2.5",
        selected && "ring-2 ring-ring ring-offset-2",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        <div className="min-w-0 self-stretch">
          <p className="m-0 text-subtitle">Remote content, not loaded</p>
          <p className="m-0 truncate text-body text-muted-foreground">{url}</p>
        </div>
        <Button
          variant="secondary"
          size="compact"
          leadingIcon={ExternalLinkIcon}
          onClick={() => {
            openExternalUrl(url);
          }}
        >
          Open in browser
        </Button>
      </div>
    </div>
  );
};
