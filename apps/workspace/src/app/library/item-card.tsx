// One item as a card: its cover from the library's files (where the page's host draws them: the
// cloud's own route in the tab, the shell's scheme on the Mac), else a tile for its kind; a note shows its first paragraph. The
// card only reports gestures: the grid owns the selection, the focus and the menu.

import { FileKindIcon } from "@repo/editor/nodes/file-card";
import type { ReplicaListingRow } from "@repo/library-replica/library-replica";
import { shownTitle } from "@repo/notes/items/item-name";
import {
  MediaCard,
  MediaCardBadge,
  MediaCardBody,
  MediaCardCover,
  MediaCardDescription,
  MediaCardMeta,
  MediaCardTitle,
} from "@repo/ui/components/media-card";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/components/popover";
import { landedInside } from "@repo/ui/lib/landed-inside";
import {
  CloudUploadIcon,
  FileTextIcon,
  MusicIcon,
  PinIcon,
  PlayIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";

import { useFileUrl } from "../cloud/library-context";
import { cardMeta, coverOf, fileExtensionLabel } from "./item-labels";

export interface ItemCardProps {
  readonly row: ReplicaListingRow;
  readonly selected: boolean;
  // the one card Tab reaches; the grid's arrows move it
  readonly tabStop: boolean;
  readonly nowMs: number;
  readonly onPress: (row: ReplicaListingRow, event: MouseEvent<HTMLDivElement>) => void;
  readonly onOpen: (row: ReplicaListingRow) => void;
  readonly onMenu: (row: ReplicaListingRow, anchor: HTMLElement) => void;
}

const hueOf = (text: string): number => {
  let hash = 0;
  for (const char of text) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
  }
  return hash;
};

// a site's initial on a tile tinted by its name, so one site's cards read as one
const MonogramTile = ({ label }: { label: string }) => {
  const hue = hueOf(label);
  return (
    <div
      aria-hidden="true"
      className="flex size-full items-center justify-center text-display font-semibold"
      style={{
        backgroundColor: `color-mix(in srgb, hsl(${String(hue)} 55% 50%) 16%, var(--surface))`,
        color: `color-mix(in srgb, hsl(${String(hue)} 55% 40%) 75%, var(--ink))`,
      }}
    >
      {label.slice(0, 1).toLocaleUpperCase()}
    </div>
  );
};

const GlyphTile = ({ row }: { row: ReplicaListingRow }) => {
  if (row.kind === "pdf") {
    return (
      <div aria-hidden="true" className="flex size-full items-center justify-center">
        <FileTextIcon className="size-10 text-muted-foreground" strokeWidth={1.25} />
      </div>
    );
  }
  if (row.kind === "video" || row.kind === "audio") {
    return (
      <div aria-hidden="true" className="flex size-full items-center justify-center">
        {row.kind === "video" ? (
          <PlayIcon className="size-10 text-muted-foreground" strokeWidth={1.25} />
        ) : (
          <MusicIcon className="size-10 text-muted-foreground" strokeWidth={1.25} />
        )}
      </div>
    );
  }
  const name = row.fields.originalName ?? row.title;
  const extension = fileExtensionLabel(name);
  return (
    <div aria-hidden="true" className="flex size-full flex-col items-center justify-center gap-1">
      <FileKindIcon name={name} className="size-9 text-muted-foreground" strokeWidth={1.25} />
      {extension === "" ? null : (
        <span className="text-caption font-medium text-muted-foreground">{extension}</span>
      )}
    </div>
  );
};

// the cover, or nothing once the library could not answer it
const CoverImage = ({ sha }: { sha: string }) => {
  const fileUrl = useFileUrl();
  const [failed, setFailed] = useState(false);
  if (failed) {
    return null;
  }
  return (
    <img
      alt=""
      draggable={false}
      loading="lazy"
      decoding="async"
      src={fileUrl(sha)}
      onError={() => {
        setFailed(true);
      }}
    />
  );
};

const CoverArea = ({ row }: { row: ReplicaListingRow }) => {
  if (row.fields.fetchState === "pending") {
    return (
      <div className="flex size-full items-center justify-center bg-muted/60">
        <span className="text-body text-muted-foreground">Not read yet</span>
      </div>
    );
  }
  const cover = coverOf(row);
  if (cover !== null) {
    return <CoverImage key={cover} sha={cover} />;
  }
  if (row.kind === "note") {
    return row.card.preview === "" ? (
      <div aria-hidden="true" className="flex size-full items-center justify-center">
        <FileTextIcon className="size-8 text-muted-foreground/60" strokeWidth={1.25} />
      </div>
    ) : (
      <p className="m-0 line-clamp-6 px-3 py-2.5 text-body break-words text-ink-2">
        {row.card.preview}
      </p>
    );
  }
  if (row.kind === "link") {
    return <MonogramTile label={row.fields.site ?? row.title} />;
  }
  return <GlyphTile row={row} />;
};

export const ItemCard = ({
  row,
  selected,
  tabStop,
  nowMs,
  onPress,
  onOpen,
  onMenu,
}: ItemCardProps) => {
  const playable = (row.kind === "video" || row.kind === "audio") && row.fields.coverSha !== null;
  const title = shownTitle(row.title);
  return (
    <MediaCard
      selected={selected}
      tabIndex={tabStop ? 0 : -1}
      data-item-id={row.id}
      aria-label={title}
      // each gesture is the card's only where it landed on the card: the unread reason's popover
      // is its child in React's tree, and a double-click selecting a word there would open the item
      onClick={(event) => {
        if (!landedInside(event)) {
          return;
        }
        onPress(row, event);
        // a double-click opens on its second click, never on the `dblclick` after it: the click
        // before it can have re-rendered this card into a new element, where the `dblclick` lands
        // on a detached one that reaches no handler
        if (event.detail === 2) {
          onOpen(row);
        }
      }}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (landedInside(event) && event.key === "ContextMenu") {
          event.preventDefault();
          onMenu(row, event.currentTarget);
        }
      }}
      onContextMenu={(event) => {
        if (!landedInside(event)) {
          return;
        }
        event.preventDefault();
        onMenu(row, event.currentTarget);
      }}
    >
      <MediaCardCover>
        <CoverArea row={row} />
        {playable ? <MediaCardBadge icon={<PlayIcon />} position="top-right" /> : null}
        {row.pinnedAt === null ? null : (
          <MediaCardBadge icon={<PinIcon />} position="top-left" aria-label="Pinned" />
        )}
        {row.unsent ? (
          <MediaCardBadge
            icon={<CloudUploadIcon />}
            position="top-right"
            aria-label="Not sent yet"
          />
        ) : null}
        {row.fields.fetchError === null ? null : (
          // why the page went unread is something to read, so it opens on a hover or a tap, which a
          // tooltip, off on touch, would not
          <Popover>
            <PopoverTrigger
              openOnHover
              nativeButton={false}
              render={<MediaCardBadge icon={<TriangleAlertIcon />} />}
            >
              Page not read
            </PopoverTrigger>
            <PopoverContent side="top" className="w-64 gap-0 rounded-xl p-3 text-body select-text">
              {row.fields.fetchError}
            </PopoverContent>
          </Popover>
        )}
      </MediaCardCover>
      <MediaCardBody>
        <MediaCardTitle>{title}</MediaCardTitle>
        <MediaCardMeta>{cardMeta(row, nowMs)}</MediaCardMeta>
        {row.fields.description === null ? null : (
          <MediaCardDescription>{row.fields.description}</MediaCardDescription>
        )}
      </MediaCardBody>
    </MediaCard>
  );
};
